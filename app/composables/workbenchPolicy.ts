import type { AnalyzeRequest, Proposal, Run } from '#shared/p0/types';
import type { RunMode } from '#shared/p0/api';

export function buildRunRequest(
	baseRev: number,
	mode: RunMode,
	allowed: boolean,
): AnalyzeRequest | null {
	if (mode === 'fixture') {
		return { baseRev, mode };
	}
	return allowed ? { baseRev, mode, allowExternal: true } : null;
}

export function proposalBlocked(
	discovery: Pick<Run, 'stale'> | null,
	proposal: Pick<Proposal, 'stale'>,
): boolean {
	return !discovery || discovery.stale || proposal.stale;
}

type ReviewTarget = { id: string };
type ReviewTargets = {
	workflow: { steps: ReviewTarget[] };
	questions: ReviewTarget[];
	opportunities: ReviewTarget[];
	proposals: { plan: ReviewTarget }[];
};

export function removedReviewTargets(
	previous: ReviewTargets,
	next: ReviewTargets,
): boolean {
	const removed = (before: ReviewTarget[], after: ReviewTarget[]) => {
		const activeIds = new Set(after.map(({ id }) => id));
		return before.some(({ id }) => !activeIds.has(id));
	};
	return (
		removed(previous.workflow.steps, next.workflow.steps)
		|| removed(previous.questions, next.questions)
		|| removed(previous.opportunities, next.opportunities)
		|| removed(
			previous.proposals.map(({ plan }) => plan),
			next.proposals.map(({ plan }) => plan),
		)
	);
}
