<script setup lang="ts">
		import type { AnalyzeResponse, ErrorBody } from '#shared/p0/api';
		import type { PublicTask, Quantity, TaskDraft } from '#shared/shima/schemas';
		import {
			canPreparePreview,
			effortMinutesPerWeek,
			formatPotentialPerMonth,
			formatSpentPerWeek,
			quantityBasisLabel,
			yenDisplay,
		} from '../composables/shimaFormat';
		import type { Session } from '#shared/p0/types';

	// The tracer page drives the documented hotel fixture end to end: hear
	// (scripted role-play fallback), map (owner-reported effort), match
	// (package → exact preview → owner approval). Loopback demo only: no
	// microphone capture and no live AI on this page.
	const CID = 'cli_hotel_demo';
	const SID = 'ses_hotel_demo';
	const S = `/api/clients/${CID}/sessions/${SID}`;
	const OPPORTUNITY_ID = 'opp_hotel_02';
	const STEP_ID = 'step_hotel_08';
	const EFFORT_BASIS = '繁忙期にオーナーが口頭で報告した概数。';
	// The fixture accepts exactly this wording on question q_hotel_01.
	const SCRIPTED_ANSWER =
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

	type MapView = {
		rev: number;
		stale: boolean;
		manualEffort: {
			stepId: string;
			weeklyOccurrences: Quantity;
			minutesPerOccurrence: Quantity;
			minutesSpentPerWeek: number | null;
		}[];
		gaps: { questionId: string; prompt: string }[];
		opportunities: {
			opportunityId: string;
			estimatedHoursSavedPerMonth: number | null;
		}[];
	};

	type PackageView = {
		id: string;
		opportunityId: string;
		state: 'draft' | 'published';
		stale: boolean;
		previewId: string | null;
		questId: string | null;
		draft: TaskDraft;
	};

	type PreviewView = { id: string; hash: string; task: PublicTask };

	const busy = ref(false);
	const notice = ref('');
	const problem = ref('');
	const session = ref<Session | null>(null);
	const map = ref<MapView | null>(null);
	const packages = ref<PackageView[]>([]);
	const activePackage = ref<PackageView | null>(null);
	const preview = ref<PreviewView | null>(null);
	const answerText = ref(SCRIPTED_ANSWER);
	const occurrences = ref(10);
	const minutes = ref(15);
	const yenInput = ref('80000');
	const dateInput = ref('2026-12-18');
	const confirmBudget = ref(false);
	const approvePreview = ref(false);
	const publishedQuestId = ref('');

	useHead({
		title: 'しまトレーサー（フィクション工事デモ）',
		htmlAttrs: { lang: 'ja' },
	});

	const effortBasisText = ref(EFFORT_BASIS);
	const answer = computed(() => {
		const question = session.value?.questions.find(
			(candidate) => candidate.id === 'q_hotel_01',
		);
		return question?.answer ?? null;
	});
	const effortRow = computed(() =>
		map.value?.manualEffort.find((row) => row.stepId === STEP_ID) ?? null,
	);
	const roomChangeOpportunity = computed(() =>
		map.value?.opportunities.find(
			(entry) => entry.opportunityId === OPPORTUNITY_ID,
		) ?? null,
	);
	const previewReady = computed(() =>
		activePackage.value
			&& preview.value
			&& canPreparePreview(
				{
					proposedBudgetYen: activePackage.value.draft.proposedBudgetYen,
					targetDate: activePackage.value.draft.targetDate,
				},
				{
					confirmedBudgetYen: preview.value.task.confirmedBudgetYen,
					targetDate: preview.value.task.targetDate,
				},
			)
			? true
			: false,
	);

	function apiErrorOf(error: unknown) {
		return (error as { data?: ErrorBody })?.data?.error;
	}

	async function run(label: string, operation: () => Promise<void>) {
		if (busy.value) {
			return;
		}
		busy.value = true;
		problem.value = '';
		notice.value = label;
		try {
			await operation();
		} catch (error) {
			problem.value = apiErrorOf(error)?.message ?? '操作に失敗しました。';
		} finally {
			busy.value = false;
			notice.value = '';
		}
	}

	async function refreshAll() {
		session.value = await $fetch<Session>(S);
		map.value = await $fetch<MapView>(`${S}/shima/map`);
		const listing = await $fetch<{ packages: PackageView[] }>(
			`${S}/shima/packages`,
		);
		packages.value = listing.packages;
		const active = packages.value.find(
			(candidate) => candidate.opportunityId === OPPORTUNITY_ID,
		);
		if (active && active.id === activePackage.value?.id) {
			activePackage.value = active;
		} else if (active) {
			activePackage.value = active;
		}
	}

	function prepareDemo() {
		return run('デモを準備しています…', async () => {
			const seeded = await $fetch<Session>('/api/demo/hotel', {
				method: 'POST',
				body: {},
			});
			await $fetch(`${S}/analyze`, {
				method: 'POST',
				body: { baseRev: seeded.rev, mode: 'fixture' },
			});
			await refreshAll();
			notice.value = 'デモの準備ができました。';
		});
	}

	function submitAnswer() {
		return run('補足の回答を記録しています…', async () => {
			if (!session.value) {
				throw new Error('デモを先に準備してください。');
			}
			const answered = await $fetch<Session>(
				`${S}/questions/q_hotel_01/answer`,
				{
					method: 'PUT',
					body: { baseRev: session.value.rev, text: answerText.value },
				},
			);
			await $fetch(`${S}/analyze`, {
				method: 'POST',
				body: { baseRev: answered.rev, mode: 'fixture' },
			});
			await refreshAll();
			notice.value = '回答を記録し、分析を更新しました。';
		});
	}

	function recordEffort() {
		return run('工数を記録しています…', async () => {
			if (!map.value || !answer.value) {
				throw new Error('先にデモの準備と回答が必要です。');
			}
			const evidence = [
				{
					sourceId: answer.value.id,
					sourceRev: answer.value.sourceRev,
					quote: answer.value.text,
				},
			];
			const effort = {
				weeklyOccurrences: {
					kind: 'owner-reported',
					value: occurrences.value,
					basis: effortBasisText.value,
					evidence,
				},
				minutesPerOccurrence: {
					kind: 'owner-reported',
					value: minutes.value,
					basis: effortBasisText.value,
					evidence,
				},
			};
			const recorded = await $fetch<{ rev: number; map: MapView }>(
				`${S}/shima/effort/${STEP_ID}`,
				{
					method: 'PUT',
					body: { baseRev: map.value.rev, effort },
					headers: { 'idempotency-key': crypto.randomUUID() },
				},
			);
			map.value = recorded.map;
			notice.value = '工数を記録しました。';
		});
	}

	function createPackage() {
		return run('たたき案を作成しています…', async () => {
			if (!session.value || !map.value) {
				throw new Error('デモを先に準備してください。');
			}
			const sectionRev = map.value.rev;
			try {
				// Let the proposal route reuse an existing fixture proposal only if
				// its server-side basis still matches. It does not bump the Shima rev.
				const proposed = await $fetch<AnalyzeResponse>(
					`${S}/opportunities/${OPPORTUNITY_ID}/proposal`,
					{
						method: 'POST',
						body: { baseRev: session.value.rev, mode: 'fixture' },
						retry: 0,
					},
				);
				session.value = proposed.session;
				const created = await $fetch<{ rev: number; package: PackageView }>(
					`${S}/shima/packages`,
					{
						method: 'POST',
						body: { baseRev: sectionRev, opportunityId: OPPORTUNITY_ID },
						headers: { 'idempotency-key': crypto.randomUUID() },
						retry: 0,
					},
				);
				activePackage.value = created.package;
				preview.value = null;
				await refreshAll();
				notice.value = 'たたき案を作成しました。';
			} catch (error) {
				if (apiErrorOf(error)?.code === 'stale_revision') {
					// Refresh for a manual retry; don't repeat either write on conflict.
					await refreshAll().catch(() => undefined);
				}
				throw error;
			}
		});
	}

	function applyDraft() {
		return run('条件を保存しています…', async () => {
			if (!activePackage.value || !map.value) {
				throw new Error('たたき案を先に作成してください。');
			}
			const patched = await $fetch<{ rev: number; package: PackageView }>(
				`${S}/shima/packages/${activePackage.value.id}`,
				{
					method: 'PATCH',
					body: {
						baseRev: map.value.rev,
						fields: {
							proposedBudgetYen: Number(yenInput.value),
							targetDate: dateInput.value,
						},
					},
					headers: { 'idempotency-key': crypto.randomUUID() },
				},
			);
			activePackage.value = patched.package;
			preview.value = null;
			map.value = await $fetch<MapView>(`${S}/shima/map`);
			notice.value = '条件を保存しました。';
		});
	}

	function makePreview() {
		return run('プレビューを準備しています…', async () => {
			if (!activePackage.value || !map.value) {
				throw new Error('たたき案を先に作成してください。');
			}
			const made = await $fetch<{ rev: number; preview: PreviewView }>(
				`${S}/shima/packages/${activePackage.value.id}/preview`,
				{
					method: 'POST',
					body: { baseRev: map.value.rev },
					headers: { 'idempotency-key': crypto.randomUUID() },
				},
			);
			preview.value = made.preview;
			confirmBudget.value = false;
			approvePreview.value = false;
			map.value = await $fetch<MapView>(`${S}/shima/map`);
			notice.value = 'プレビューを準備しました。';
		});
	}

	function publishQuest() {
		return run('公開しています…', async () => {
			if (!activePackage.value || !preview.value || !map.value) {
				throw new Error('プレビューを先に準備してください。');
			}
			const published = await $fetch<{
				rev: number;
				quest: { id: string };
			}>(`${S}/shima/packages/${activePackage.value.id}/publish`, {
				method: 'POST',
				body: {
					baseRev: map.value.rev,
					previewId: preview.value.id,
					previewHash: preview.value.hash,
					confirmedBudgetYen: Number(yenInput.value),
					confirmBudget: confirmBudget.value,
					approvePreview: approvePreview.value,
				},
				headers: { 'idempotency-key': crypto.randomUUID() },
			});
			publishedQuestId.value = published.quest.id;
			await refreshAll();
			notice.value = '公開しました。掲示板を開いてください。';
		});
	}

	onMounted(() => {
		preview.value = null;
		void run('読み込んでいます…', refreshAll);
	});
</script>

<template>
	<div class="shima-page">
		<header class="shima-heading">
			<div>
				<p class="eyebrow">しまトレーサー / 佐渡島の宿（フィクション工事）</p>
				<h1>聞く → 写す → 揃える（デモ）</h1>
			</div>
			<div class="actions">
				<span class="fixture-tag">フィクション・デモ — 実収録も実AIもなし</span>
				<NuxtLink
					class="pill"
					to="/quests"
					>掲示板を見る</NuxtLink
				>
			</div>
		</header>
		<p
			v-if="problem"
			class="problem"
			role="alert"
		>
			{{ problem }}
		</p>
		<p
			v-else-if="notice"
			class="quiet"
		>
			{{ notice }}
		</p>

		<section class="panel">
			<h2>聞く（ロールプレイ）</h2>
			<p class="quiet">
				台本どおりの架空ヒアリングです。録音は使わず、台本文をそのまま記録します。
			</p>
			<div class="row">
				<button
					class="primary"
					:disabled="busy"
					@click="prepareDemo"
				>
					デモを準備（面談＋初期分析）
				</button>
				<button
					class="primary"
					:disabled="busy || !session"
					@click="submitAnswer"
				>
					補足質問に答えて再分析
				</button>
			</div>
			<label class="field">
				<span>補足回答（台本）</span>
				<textarea
					v-model="answerText"
					rows="4"
				></textarea>
			</label>
			<p
				v-if="answer"
				class="quiet fine mono"
			>
				記録済みの回答: {{ answer.id }}（改訂 {{ answer.sourceRev }}）
			</p>
		</section>

		<section class="panel">
			<h2>写す（工程の見取り図）</h2>
			<p
				v-if="map"
				class="quiet"
			>
				改訂 {{ map.rev }}・
				<span :class="{ attention: map.stale }">{{
					map.stale ? '分析が古い' : '分析は最新'
				}}</span>
			</p>
			<ul
				v-if="map && map.gaps.length"
				class="plain"
			>
				<li
					v-for="gap in map.gaps"
					:key="gap.questionId"
				>
					未解決の質問: {{ gap.prompt }}
				</li>
			</ul>
			<ul
				v-if="map && map.opportunities.length"
				class="plain"
			>
				<li
					v-for="entry in map.opportunities"
					:key="entry.opportunityId"
				>
					{{ entry.opportunityId }} — 潜在
					{{ formatPotentialPerMonth(entry.estimatedHoursSavedPerMonth) }}
				</li>
			</ul>
			<div
				v-if="effortRow"
				class="effort-row"
			>
				<span class="mono">{{ effortRow.stepId }}</span>
				<span
					>週 {{ effortRow.weeklyOccurrences.value }}回 ×
					{{ effortRow.minutesPerOccurrence.value }}分 =</span
				>
				<strong>{{
					formatSpentPerWeek(effortMinutesPerWeek(effortRow.weeklyOccurrences, effortRow.minutesPerOccurrence))
				}}</strong>
				<span class="pill">{{
					quantityBasisLabel(effortRow.weeklyOccurrences)
				}}</span>
			</div>
			<form
				class="row"
				@submit.prevent="recordEffort"
			>
				<label class="field">
					<span>週あたりの回数</span>
					<input
						v-model.number="occurrences"
						type="number"
						min="0"
					/>
				</label>
				<label class="field">
					<span>1回あたりの分</span>
					<input
						v-model.number="minutes"
						type="number"
						min="0"
					/>
				</label>
				<label class="field grow">
					<span>根拠（オーナーの言葉）</span>
					<input
						v-model="effortBasisText"
						type="text"
					/>
				</label>
				<button
					class="primary"
					type="submit"
					:disabled="busy || !answer"
				>
					工数を記録
				</button>
			</form>
			<p class="quiet fine">
				記録した週の実時間は、月あたりの潜在（{{ formatPotentialPerMonth(roomChangeOpportunity?.estimatedHoursSavedPerMonth ?? null) }}）と別の値として扱います。
			</p>
		</section>

		<section class="panel">
			<h2>揃える（提案 → 公開）</h2>
			<div class="row">
				<button
					class="primary"
					:disabled="busy || !session || !map"
					@click="createPackage"
				>
					たたき案を作成
				</button>
			</div>
			<div
				v-if="activePackage"
				class="package"
			>
				<h3>{{ activePackage.draft.title }}</h3>
				<p>{{ activePackage.draft.problem }}</p>
				<dl class="draft">
					<dt>変更内容</dt>
					<dd>{{ activePackage.draft.proposedChange }}</dd>
					<dt>成果物</dt>
					<dd>
						<ul class="plain">
							<li
								v-for="item in activePackage.draft.deliverables"
								:key="item"
							>
								{{ item }}
							</li>
						</ul>
					</dd>
					<dt>状態</dt>
					<dd>
						{{ activePackage.state === 'published' ? '公開済み' : 'たたき案' }}
						<span
							v-if="activePackage.stale"
							class="attention"
							>（提案が古くなりました）</span
						>
					</dd>
				</dl>
				<form
					class="row"
					@submit.prevent="applyDraft"
				>
					<label class="field">
						<span>確定額（円・一致が必要）</span>
						<input
							v-model="yenInput"
							type="number"
							min="0"
							step="1"
						/>
					</label>
					<label class="field">
						<span>期日（YYYY-MM-DD・一致が必要）</span>
						<input
							v-model="dateInput"
							type="text"
						/>
					</label>
					<button
						class="primary"
						type="submit"
						:disabled="busy || activePackage.state !== 'draft'"
					>
						条件を保存
					</button>
				</form>
				<div class="row">
					<button
						class="primary"
						:disabled="busy || activePackage.state !== 'draft'"
						@click="makePreview"
					>
						プレビューを準備
					</button>
				</div>
				<div
					v-if="preview"
					class="preview"
				>
					<h4>公開プレビュー（外部に出る内容の最終確認）</h4>
					<p class="mono fine">hash: {{ preview.hash }}</p>
					<dl class="draft">
						<dt>タイトル</dt>
						<dd>{{ preview.task.title }}</dd>
						<dt>確定額</dt>
						<dd>{{ yenDisplay(preview.task.confirmedBudgetYen) }}</dd>
						<dt>期日</dt>
						<dd>{{ preview.task.targetDate }}</dd>
						<dt>作れるもの</dt>
						<dd>
							<ul class="plain">
								<li
									v-for="item in preview.task.deliverables"
									:key="item"
								>
									{{ item }}
								</li>
							</ul>
						</dd>
					</dl>
					<label class="check">
						<input
							v-model="confirmBudget"
							type="checkbox"
						/>
						確定額 {{ yenDisplay(preview.task.confirmedBudgetYen) }} を確認しました
					</label>
					<label class="check">
						<input
							v-model="approvePreview"
							type="checkbox"
						/>
						プレビューの内容を承認します
					</label>
					<div class="row">
						<button
							class="primary"
							:disabled="busy || !previewReady || !confirmBudget || !approvePreview"
							@click="publishQuest"
						>
							この内容で公開する
						</button>
					</div>
				</div>
				<p
					v-if="publishedQuestId"
					class="quiet"
				>
					公開済み:
					<NuxtLink :to="`/quests?q=${publishedQuestId}`">{{
						publishedQuestId
					}}</NuxtLink>
				</p>
			</div>
		</section>
	</div>
</template>

<style scoped>
	.shima-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 60rem;
	}
	.shima-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}
	.panel {
		border: 1px solid var(--border, #ddd);
		border-radius: 0.5rem;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.field.grow {
		flex: 1;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.problem {
		color: var(--danger, #b3261e);
	}
	.attention {
		color: var(--warning, #8a6100);
		font-weight: 600;
	}
	.effort-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	.package {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border-top: 1px solid var(--border, #ddd);
		padding-top: 0.75rem;
	}
	.preview {
		border-left: 3px solid var(--accent, #2563eb);
		padding-left: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.draft dt {
		font-weight: 600;
		margin-top: 0.5rem;
	}
	.draft dd {
		margin: 0.25rem 0 0;
	}
</style>
