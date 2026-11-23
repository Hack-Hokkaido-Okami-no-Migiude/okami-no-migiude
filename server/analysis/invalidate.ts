// Pure invalidation helpers published for the storage seam. The store (or any
// writer) calls `computeInvalidation` when committing source/answer/assumption
// edits; no provider, store, or Nitro imports happen here. Discovery commits
// bypass this helper — a fresh discovery rewrites the workflow itself and must
// not immediately stale its own run.
import type { Id, Proposal, Session } from '../../shared/p0/types';

export type Invalidation = {
	/** Transcript rows, saved answers, or step corrections changed: discovery is stale. */
	discoveryStale: boolean;
	/** Proposals whose own basis (current graph + opportunity incl. assumptions) changed. */
	staleProposalIds: Id[];
};

export function computeInvalidation(
	previous: Session,
	next: Session,
): Invalidation {
	return {
		discoveryStale:
			!sameTranscript(previous, next)
			|| !sameAnswers(previous, next)
			|| !sameWorkflow(previous, next),
		staleProposalIds: next.proposals
			.filter((proposal) =>
				proposalBasisChanged(previous, next, proposal),
			)
			.map((proposal) => proposal.opportunityId),
	};
}

function sameTranscript(previous: Session, next: Session): boolean {
	return stableJson(previous.transcript) === stableJson(next.transcript);
}

function sameAnswers(previous: Session, next: Session): boolean {
	const answerOf = (session: Session) =>
		session.questions.map((question) => ({
			id: question.id,
			status: question.status,
			answer: question.answer,
		}));
	return stableJson(answerOf(previous)) === stableJson(answerOf(next));
}

/** A step correction changes the graph, which is part of discovery's basis. */
function sameWorkflow(previous: Session, next: Session): boolean {
	return stableJson(previous.workflow) === stableJson(next.workflow);
}

function proposalBasisChanged(
	previous: Session,
	next: Session,
	proposal: Proposal,
): boolean {
	const previousOpportunity = previous.opportunities.find(
		(entry) => entry.id === proposal.opportunityId,
	);
	const nextOpportunity = next.opportunities.find(
		(entry) => entry.id === proposal.opportunityId,
	);
	return (
		stableJson(previousOpportunity) !== stableJson(nextOpportunity)
		|| stableJson(previous.workflow) !== stableJson(next.workflow)
	);
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested: unknown) => {
		if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
			return Object.fromEntries(
				Object.entries(nested as Record<string, unknown>).sort(
					([left], [right]) => left.localeCompare(right),
				),
			);
		}
		return nested;
	});
}
