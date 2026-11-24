import type { ShimaPackageView, ShimaPreview } from './useShimaTypes';
import type { PublicTask } from '#shared/shima/schemas';
import { canPreparePreview } from './shimaFormat';

const publicTaskLabels = {
	title: 'タイトル',
	problem: '困りごと',
	proposedChange: '変更内容',
	deliverables: '成果物',
	acceptanceCriteria: '受け入れ条件',
	skills: '必要なスキル',
	integrations: '連携先',
	benefits: '期待される効果',
	prerequisites: '前提条件',
	limitations: '制約・対象外',
	confirmedBudgetYen: '確定額（円）',
	targetDate: '期日',
	estimatedHoursSavedPerMonth: '削減時間の月間上限（時間/月）',
} satisfies Record<keyof PublicTask, string>;

export function publicTaskFields(task: PublicTask) {
	return (Object.keys(publicTaskLabels) as (keyof PublicTask)[]).map(
		(key) => ({
			key,
			label: publicTaskLabels[key],
			value: task[key],
		}),
	);
}

type DecisionView = Pick<ShimaPackageView, 'ownerDecision'>;

export function shimaIntent(view: DecisionView) {
	if (view.ownerDecision === 'decline') {
		return 'declined';
	}
	if (view.ownerDecision === 'accept') {
		return 'accepted';
	}
	return null;
}

export function shimaPublished(view: Pick<ShimaPackageView, 'state'>) {
	return view.state === 'published';
}

export function shimaCompleted(
	view: Pick<ShimaPackageView, 'state' | 'completed'>,
) {
	return shimaPublished(view) && view.completed === true;
}

export function canShowShimaApprovals(
	view:
		| (DecisionView
				& Pick<ShimaPackageView, 'state' | 'stale' | 'previewId'> & {
					draft: Pick<
						ShimaPackageView['draft'],
						'proposedBudgetYen' | 'targetDate'
					>;
				})
		| null,
	preview: ShimaPreview | null,
) {
	return Boolean(
		view
		&& preview
		&& !view.stale
		&& !shimaPublished(view)
		&& shimaIntent(view) === 'accepted'
		&& view.previewId === preview.id
		&& canPreparePreview(view.draft, preview.task),
	);
}

export function canPublishShimaPreview(input: {
	package: Parameters<typeof canShowShimaApprovals>[0];
	preview: ShimaPreview | null;
	confirmBudget: boolean;
	approvePreview: boolean;
}) {
	return (
		input.confirmBudget
		&& input.approvePreview
		&& canShowShimaApprovals(input.package, input.preview)
	);
}

export function shimaProblem(error: unknown) {
	const response = error as {
		data?: { error?: { code?: string } };
		status?: number;
	} | null;
	switch (response?.data?.error?.code) {
		case 'stale_revision':
			return '別の画面で更新されました。最新の状態を読み込んでから操作してください。';
		case 'stale_artifact':
			return '根拠や条件が変わりました。最新の状態を読み込んで見直してください。';
		case 'fixture_unsupported':
			return 'この操作はデモ台本と指定条件にのみ対応しています。';
		case 'already_claimed':
			return 'ほかの人が先に申し込みました。';
		case 'invalid_input':
			return '入力した条件を確認してください。';
		case 'not_found':
			return '現在この操作は利用できません。';
		default:
			return response?.status === 404 ?
					'現在この操作は利用できません。'
				:	'操作結果を確認できませんでした。最新の状態を読み込んでください。';
	}
}
