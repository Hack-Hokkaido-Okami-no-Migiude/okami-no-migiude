import type {
	ShimaMapView,
	ShimaPackageView,
	ShimaPreview,
	ShimaQuestDetail,
} from './useShimaTypes';
import {
	canPublishShimaPreview,
	shimaCompleted,
	shimaIntent,
	shimaProblem,
	shimaPublished,
} from './useShimaPresentation';
import type { AnalyzeResponse } from '#shared/p0/api';
import { PublicTaskSchema } from '#shared/shima/schemas';
import type { Session } from '#shared/p0/types';

const sessionPath = '/api/clients/cli_hotel_demo/sessions/ses_hotel_demo';
const packagePath = `${sessionPath}/shima/packages`;
const mapPath = `${sessionPath}/shima/map`;
export const shimaDemoQuestion =
	'清掃予定を渡した後の部屋変更は、繁忙期に週何回くらいあり、電話と表の書き直しに1回何分くらいかかりますか？';
export const shimaDemoQuestionId = 'q_hotel_01';
export const shimaDemoStepId = 'step_hotel_08';
export const shimaDemoOpportunityId = 'opp_hotel_02';

// The fixture accepts only the checked-in original-language answer, not the Japanese summary.
const scriptedAnswer =
	'Roughly two or three modification emails a day in high season, and maybe '
	+ 'one a day outside it; each one takes a couple of minutes to fix in '
	+ 'YukiReserve. The bigger headache is room changes. Whenever we change a '
	+ 'booking in YukiReserve — a modification email or a guest at the desk '
	+ 'asking to move rooms — if the room change happens after the 7:30 '
	+ 'arrivals list has gone over, we phone the housekeeping desk and Abe '
	+ 'rewrites the affected rows in the Excel schedule sheet by hand. I would '
	+ 'say we phone through about ten room changes a week in high season, and '
	+ 'each call plus the rewrite takes about a quarter of an hour. If we '
	+ 'forget to call, housekeeping sometimes cleans the wrong room first.';
const effortQuote =
	'about ten room changes a week in high season, and each call plus the rewrite takes about a quarter of an hour';

type Snapshot = {
	session: Session;
	map: ShimaMapView;
	package: ShimaPackageView | null;
};
type PackageWrite = { rev: number; package: ShimaPackageView };
type PublishApproval = { confirmBudget: boolean; approvePreview: boolean };
type DraftConditions = {
	proposedBudgetYen: number | null;
	targetDate: string | null;
};

function shimaWriteHeaders() {
	return { 'Idempotency-Key': crypto.randomUUID() };
}

export function useShimaDemo() {
	const busy = ref('');
	const problem = ref('');
	const notice = ref('');
	const snapshot = shallowRef<Snapshot | null>(null);
	const preview = shallowRef<ShimaPreview | null>(null);
	const quest = shallowRef<ShimaQuestDetail | null>(null);
	const needsRefresh = ref(false);
	const session = computed(() => snapshot.value?.session ?? null);
	const map = computed(() => snapshot.value?.map ?? null);
	const activePackage = computed(() => snapshot.value?.package ?? null);
	const answer = computed(
		() =>
			session.value?.questions.find(
				(item) => item.id === shimaDemoQuestionId,
			)?.answer ?? null,
	);
	const disabled = computed(() => Boolean(busy.value || needsRefresh.value));

	async function readSnapshot() {
		const [session, map, listing] = await Promise.all([
			$fetch<Session>(sessionPath),
			$fetch<ShimaMapView>(mapPath),
			$fetch<{ rev: number; packages: ShimaPackageView[] }>(packagePath),
		]);
		if (
			session.origin !== 'hotel-demo'
			|| (session.discovery && session.discovery.mode !== 'fixture')
		) {
			snapshot.value = null;
			quest.value = null;
			throw new Error('Invalid fixture session');
		}
		if (
			map.rev !== listing.rev
			|| Boolean(!session.discovery || session.discovery.stale)
				!== map.stale
		) {
			throw new Error('Concurrent fixture update');
		}
		const active =
			listing.packages.find(
				(item) => item.opportunityId === shimaDemoOpportunityId,
			) ?? null;
		snapshot.value = { session, map, package: active };
		quest.value = null;
		if (active?.questId && shimaPublished(active)) {
			const detail = await $fetch<ShimaQuestDetail>(
				`/api/quests/${encodeURIComponent(active.questId)}`,
			);
			if (
				detail.id !== active.questId
				|| !PublicTaskSchema.safeParse(detail.task).success
			) {
				throw new Error('Invalid public task');
			}
			quest.value = detail;
		}
		needsRefresh.value = false;
		return snapshot.value;
	}

	async function run(
		label: string,
		success: string,
		action: () => Promise<void>,
	) {
		if (busy.value) {
			return;
		}
		busy.value = label;
		problem.value = '';
		notice.value = '';
		try {
			await action();
			notice.value = success;
		} catch (error) {
			preview.value = null;
			needsRefresh.value = true;
			problem.value = shimaProblem(error);
		} finally {
			busy.value = '';
		}
	}

	async function analyze(baseRev: number) {
		await $fetch<AnalyzeResponse>(`${sessionPath}/analyze`, {
			method: 'POST',
			body: { baseRev, mode: 'fixture' },
			retry: 0,
		});
	}

	function prepareDemo() {
		return run('デモを開いています…', 'デモを開きました。', async () => {
			let current: Session;
			try {
				current = await $fetch<Session>(sessionPath, { retry: 0 });
			} catch (error) {
				if ((error as { status?: number }).status !== 404) {
					throw error;
				}
				current = await $fetch<Session>('/api/demo/hotel', {
					method: 'POST',
					body: {},
					retry: 0,
				});
			}
			if (!current.discovery) {
				await analyze(current.rev);
			}
			await readSnapshot();
		});
	}

	function refresh() {
		return run(
			'最新の状態を読み込んでいます…',
			'最新の状態を読み込みました。',
			async () => {
				preview.value = null;
				await readSnapshot();
			},
		);
	}

	function submitAnswer() {
		const current = session.value;
		if (!current || disabled.value || (answer.value && !map.value?.stale)) {
			return;
		}
		return run(
			'台本の回答を記録しています…',
			'台本の回答を記録し、見取り図を更新しました。',
			async () => {
				const saved =
					answer.value ? current : (
						await $fetch<Session>(
							`${sessionPath}/questions/${shimaDemoQuestionId}/answer`,
							{
								method: 'PUT',
								body: {
									baseRev: current.rev,
									text: scriptedAnswer,
								},
								retry: 0,
							},
						)
					);
				await analyze(saved.rev);
				await readSnapshot();
				if (!answer.value || map.value?.stale) {
					throw new Error('Answer or analysis not confirmed');
				}
			},
		);
	}

	function recordEffort() {
		const evidenceAnswer = answer.value;
		const current = map.value;
		if (
			!evidenceAnswer?.text.includes(effortQuote)
			|| !current
			|| current.stale
			|| disabled.value
		) {
			return;
		}
		return run(
			'工数を保存しています…',
			'繁忙期の工数を保存しました。',
			async () => {
				const evidence = [
					{
						sourceId: evidenceAnswer.id,
						sourceRev: evidenceAnswer.sourceRev,
						quote: effortQuote,
					},
				];
				const basis =
					'繁忙期についての架空のオーナー報告（概数）。電話と清掃予定表の書き直しが対象。';
				const effort = {
					weeklyOccurrences: {
						kind: 'owner-reported',
						value: 10,
						basis,
						evidence,
					},
					minutesPerOccurrence: {
						kind: 'owner-reported',
						value: 15,
						basis,
						evidence,
					},
				};
				await $fetch(`${sessionPath}/shima/effort/${shimaDemoStepId}`, {
					method: 'PUT',
					body: { baseRev: current.rev, effort },
					headers: shimaWriteHeaders(),
					retry: 0,
				});
				const fresh = await readSnapshot();
				if (
					!fresh.map.manualEffort.some(
						(row) =>
							row.stepId === shimaDemoStepId
							&& row.weeklyOccurrences.value === 10
							&& row.minutesPerOccurrence.value === 15,
					)
				) {
					throw new Error('Effort not confirmed');
				}
			},
		);
	}

	async function prepareProposal(baseRev: number) {
		await $fetch<AnalyzeResponse>(
			`${sessionPath}/opportunities/${shimaDemoOpportunityId}/proposal`,
			{
				method: 'POST',
				body: { baseRev, mode: 'fixture' },
				retry: 0,
			},
		);
	}

	function createPackage() {
		const current = snapshot.value;
		if (!current || current.map.stale || disabled.value || !answer.value) {
			return;
		}
		const existing = current.package;
		if (existing && (shimaPublished(existing) || !existing.stale)) {
			return;
		}
		return run(
			existing ? '最新の根拠を反映しています…' : (
				'依頼の下書きを作っています…'
			),
			existing ?
				'最新の根拠を反映しました。条件と判断を見直してください。'
			:	'非公開の下書きを作成しました。',
			async () => {
				preview.value = null;
				await prepareProposal(current.session.rev);
				const created = await $fetch<PackageWrite>(packagePath, {
					method: 'POST',
					body: {
						baseRev: current.map.rev,
						opportunityId: shimaDemoOpportunityId,
					},
					headers: shimaWriteHeaders(),
					retry: 0,
				});
				const fresh = (await readSnapshot()).package;
				if (
					!fresh
					|| fresh.id !== created.package?.id
					|| (existing && fresh.id !== existing.id)
					|| fresh.stale
					|| fresh.state !== 'draft'
					|| fresh.ownerDecision !== null
					|| fresh.previewId !== null
				) {
					throw new Error('Draft not confirmed');
				}
			},
		);
	}

	function packageAction<Fields extends object>(
		label: string,
		success: string,
		method: 'PATCH' | 'POST',
		suffix: string,
		fields: Fields,
		verify: (fresh: ShimaPackageView) => boolean,
	) {
		const current = snapshot.value;
		if (!current?.package || disabled.value) {
			return;
		}
		const targetId = current.package.id;
		return run(label, success, async () => {
			preview.value = null;
			const result = await $fetch<PackageWrite>(
				`${packagePath}/${encodeURIComponent(targetId)}${suffix}`,
				{
					method,
					body: { baseRev: current.map.rev, ...fields },
					headers: shimaWriteHeaders(),
					retry: 0,
				},
			);
			const fresh = (await readSnapshot()).package;
			if (
				!fresh
				|| result.package?.id !== targetId
				|| fresh.id !== targetId
				|| !verify(fresh)
			) {
				throw new Error('Package transition not confirmed');
			}
		});
	}

	function reshape(fields: DraftConditions) {
		const target = activePackage.value;
		if (
			!target
			|| shimaPublished(target)
			|| target.stale
			|| map.value?.stale
		) {
			return;
		}
		return packageAction(
			'依頼条件を保存しています…',
			'依頼条件を保存しました。判断と確認は改めて行ってください。',
			'PATCH',
			'',
			{ fields },
			(fresh) =>
				!fresh.stale
				&& !shimaIntent(fresh)
				&& fresh.previewId === null
				&& fresh.draft.proposedBudgetYen === fields.proposedBudgetYen
				&& fresh.draft.targetDate === fields.targetDate,
		);
	}

	function decide(decision: 'accept' | 'decline') {
		const target = activePackage.value;
		if (
			!target
			|| shimaPublished(target)
			|| target.stale
			|| map.value?.stale
			|| shimaIntent(target)
		) {
			return;
		}
		return packageAction(
			'判断を保存しています…',
			decision === 'accept' ?
				'引き受ける意向を非公開で保存しました。'
			:	'見送る判断を非公開で保存しました。',
			'POST',
			'/decision',
			{ decision },
			(fresh) =>
				shimaIntent(fresh)
				=== (decision === 'accept' ? 'accepted' : 'declined'),
		);
	}

	function makePreview() {
		const current = snapshot.value;
		const target = current?.package;
		if (
			!target
			|| shimaPublished(target)
			|| target.stale
			|| current.map.stale
			|| shimaIntent(target) !== 'accepted'
			|| disabled.value
		) {
			return;
		}
		return run(
			'公開プレビューを準備しています…',
			'公開する全項目を表示しました。',
			async () => {
				preview.value = null;
				const made = await $fetch<{
					rev: number;
					preview: ShimaPreview;
				}>(`${packagePath}/${encodeURIComponent(target.id)}/preview`, {
					method: 'POST',
					body: { baseRev: current.map.rev },
					headers: shimaWriteHeaders(),
					retry: 0,
				});
				const fresh = await readSnapshot();
				if (
					fresh.package?.id !== target.id
					|| fresh.package.previewId !== made.preview.id
					|| fresh.map.rev !== made.rev
					|| !PublicTaskSchema.safeParse(made.preview.task).success
				) {
					throw new Error('Preview not confirmed');
				}
				preview.value = made.preview;
			},
		);
	}

	function publish(approval: PublishApproval) {
		const target = activePackage.value;
		const exact = preview.value;
		if (
			!target
			|| !exact
			|| map.value?.stale
			|| !canPublishShimaPreview({
				package: target,
				preview: exact,
				...approval,
			})
		) {
			return;
		}
		return packageAction(
			'架空の依頼を掲示板に公開しています…',
			'架空の依頼を掲示板に公開しました。',
			'POST',
			'/publish',
			{
				previewId: exact.id,
				previewHash: exact.hash,
				confirmedBudgetYen: exact.task.confirmedBudgetYen,
				...approval,
			},
			(fresh) =>
				shimaPublished(fresh)
				&& Boolean(fresh.questId && quest.value?.id === fresh.questId),
		);
	}

	function complete(criteriaConfirmed: boolean) {
		const target = activePackage.value;
		if (
			!criteriaConfirmed
			|| !target
			|| !shimaPublished(target)
			|| target.stale
			|| shimaCompleted(target)
			|| quest.value?.state !== 'claimed'
			|| quest.value.id !== target.questId
		) {
			return;
		}
		return packageAction(
			'完了を保存しています…',
			'オーナー用に完了を記録しました。',
			'POST',
			'/complete',
			{},
			shimaCompleted,
		);
	}

	return {
		busy,
		problem,
		notice,
		needsRefresh,
		disabled,
		session,
		map,
		answer,
		activePackage,
		preview,
		quest,
		prepareDemo,
		refresh,
		submitAnswer,
		recordEffort,
		createPackage,
		reshape,
		decide,
		makePreview,
		publish,
		complete,
	};
}
