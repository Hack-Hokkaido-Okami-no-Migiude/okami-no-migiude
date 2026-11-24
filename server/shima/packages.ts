// Package helpers for the match stage: the draft derived from the current
// proposal, staleness projection, and the stable package response shape. Pure
// logic — routes and the repository commit own the persistence.
import type { Plan, Proposal, Session } from '../../shared/p0/types';
import type { PublicTask, TaskDraft } from '../../shared/shima/schemas';
import type { SessionRecord } from '../store/repository';
import type { StoredPackage } from './storage';
import { canonicalJson } from '../../shared/shima/hash';
import { createHash } from 'node:crypto';
import { isProposalExportBlocked } from '../analysis/staleness';

export type ShimaPackageView = {
	id: string;
	opportunityId: string;
	state: StoredPackage['package']['state'];
	stale: boolean;
	decision: StoredPackage['package']['decision'];
	ownerDecision: NonNullable<StoredPackage['package']['ownerDecision']> | null;
	completed: boolean;
	previewId: string | null;
	questId: string | null;
	basisKey: string;
	draft: TaskDraft;
};

/** Nonempty lines of a plan section; single paragraphs stay whole. */
export function textItems(section: string | null | undefined): string[] {
	if (!section) {
		return [];
	}
	return section
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * The draft derived from the current proposal: title and problem from the
 * opportunity, change and criteria from the plan sections. Nothing is copied
 * from transcript rows.
 */
export function draftFromProposal(
	opportunity: { title: string; rationale: string; hoursSavedPerMonth: number | null },
	plan: Plan,
): TaskDraft {
	return {
		title: opportunity.title,
		problem: opportunity.rationale,
		proposedChange: plan.sections.scope,
		deliverables: textItems(plan.sections.milestones),
		acceptanceCriteria: textItems(plan.sections.acceptanceTests),
		skills: [],
		integrations: textItems(plan.sections.integrationsAuth),
		benefits: [
			`Frees about ${opportunity.hoursSavedPerMonth ?? 0} hours per month on the affected steps.`,
		],
		prerequisites: [],
		limitations: textItems(plan.sections.exceptions),
		proposedBudgetYen: null,
		targetDate: null,
	};
}

/**
 * A package is stale once its proposal is no longer the current one: a
 * different proposal run key, a stale proposal, or a discovery whose export
 * gate is closed.
 */
export function packageStaleness(
	session: Session,
	keys: SessionRecord['keys'],
	pkg: StoredPackage,
): boolean {
	const proposal = findProposal(session, pkg.package.opportunityId);
	if (!proposal) {
		return true;
	}
	return (
		pkg.package.basisKey !== packageBasis(session, keys, pkg.package.opportunityId)
		|| isProposalExportBlocked(session, proposal)
	);
}

/** Run keys exclude the plan output; bind that and the actual evidence too. */
export function packageBasis(session: Session, keys: SessionRecord['keys'], opportunityId: string): string | null {
	const proposal = findProposal(session, opportunityId);
	const opportunity = session.opportunities.find((row) => row.id === opportunityId);
	const proposalKey = keys.proposals[opportunityId];
	if (!proposal || !opportunity || !keys.discovery || !proposalKey) {
		return null;
	}
	return createHash('sha256').update(canonicalJson({
		discovery: keys.discovery,
		proposal: proposalKey,
		opportunity,
		plan: { sections: proposal.plan.sections, status: proposal.plan.status },
		answers: session.questions.flatMap((question) => question.answer ? [question.answer] : []),
	})).digest('hex');
}

/** The stable owner-facing package projection with recomputed staleness. */
export function packageProjection(
	session: Session,
	keys: SessionRecord['keys'],
	pkg: StoredPackage,
): ShimaPackageView {
	return {
		id: pkg.package.id,
		opportunityId: pkg.package.opportunityId,
		state: pkg.package.state,
		stale: packageStaleness(session, keys, pkg),
		decision: pkg.package.decision,
		ownerDecision: pkg.package.ownerDecision ?? null,
		completed: pkg.package.completion != null,
		previewId: pkg.package.previewId,
		questId: pkg.package.questId,
		basisKey: pkg.package.basisKey,
		draft: pkg.package.draft,
	};
}

export function findProposal(
	session: Session,
	opportunityId: string,
): Proposal | undefined {
	return session.proposals.find(
		(candidate) => candidate.opportunityId === opportunityId,
	);
}

/**
 * Whether the exact preview can be prepared: the draft's cost and date must
 * match the catalog commitment exactly — an unspecified value is never
 * silently substituted with the catalog amount.
 */
export function draftMatchesCatalog(
	draft: TaskDraft,
	catalogTask: PublicTask,
): boolean {
	return (
		draft.proposedBudgetYen !== null
		&& draft.proposedBudgetYen === catalogTask.confirmedBudgetYen
		&& draft.targetDate !== null
		&& draft.targetDate === catalogTask.targetDate
	);
}
