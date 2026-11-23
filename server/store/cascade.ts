// Source-change cascade: after transcript rows or saved answers change, stored
// citations that no longer validate are purged, edges that lost their support
// are removed, and losses surface as review notices. Consultant-authored
// values are never deleted: a consultant claim whose citations are all purged
// reverts to the consultant unknown form and the purged value is surfaced as a
// review-only lost-evidence notice (the claim no longer counts as evidence-
// backed data). Surviving proposals are sanitized the same way: proposed steps
// and edges lose invalidated citations, steps left without any valid citation
// are removed along with edges that referenced them, and plan sections lose
// verbatim copies of the moved source text — arbitrary plan prose that merely
// paraphrases or discusses the source is deliberately left for consultant
// review. Steps are never deleted here — a step whose label lost its support
// stays as a review-only row until the next discovery refresh.
import type {
	Edge,
	Opportunity,
	Plan,
	Proposal,
	ReviewNotice,
	Session,
	Step,
} from '../../shared/p0/types';
import { buildSourceIndex, evidenceRefIsValid } from './sources';
import { PLAN_SECTIONS } from '../../shared/p0/schemas';
import { stripClaimCitations } from './claims';

export type CitationCascade = {
	steps: Step[];
	edges: Edge[];
	opportunities: Opportunity[];
	/** Surviving proposals with purged graph citations and scrubbed plans. */
	proposals: Proposal[];
	/** Opportunities dropped because every cited source moved on. */
	droppedOpportunityIds: string[];
	lostNotices: ReviewNotice[];
	/**
	 * Quotes of citations that no longer validate: verbatim copies of moved
	 * source text that must not survive anywhere in the session.
	 */
	staleQuotes: string[];
};

type StillValid = (
	ref: { sourceId: string; sourceRev: number; quote: string },
) => boolean;

export function stripInvalidCitations(session: Session): CitationCascade {
	const sources = buildSourceIndex(session);
	const stillValid: StillValid = (ref) =>
		evidenceRefIsValid(
			{ sourceId: ref.sourceId, sourceRev: ref.sourceRev, quote: ref.quote },
			sources,
		);
	const lostNotices: ReviewNotice[] = [];
	const staleQuoteSet = new Set<string>();
	const collectStaleQuotes = (
		refs: readonly { sourceId: string; sourceRev: number; quote: string }[],
	) => {
		for (const ref of refs) {
			if (!stillValid(ref)) {
				staleQuoteSet.add(ref.quote);
			}
		}
	};

	const steps = session.workflow.steps.map((step) => {
		const label = stripClaimCitations(step.label, stillValid);
		const role = stripClaimCitations(step.role, stillValid);
		const tool = stripClaimCitations(step.tool, stillValid);
		const inputs = stripClaimCitations(step.inputs, stillValid);
		const outputs = stripClaimCitations(step.outputs, stillValid);
		const execution = stripClaimCitations(step.execution, stillValid);
		const bottleneck = stripClaimCitations(step.bottleneck, stillValid);
		const exception = stripClaimCitations(step.exception, stillValid);
		recordConsultantLosses(step.id, `step '${step.id}'`, [
			{ field: 'label', stripped: label },
			{ field: 'role', stripped: role },
			{ field: 'tool', stripped: tool },
			{ field: 'inputs', stripped: inputs },
			{ field: 'outputs', stripped: outputs },
			{ field: 'execution', stripped: execution },
			{ field: 'bottleneck', stripped: bottleneck },
			{ field: 'exception', stripped: exception },
		], lostNotices);
		return {
			...step,
			label: label.claim,
			role: role.claim,
			tool: tool.claim,
			inputs: inputs.claim,
			outputs: outputs.claim,
			execution: execution.claim,
			bottleneck: bottleneck.claim,
			exception: exception.claim,
			// A step without a known label cannot be drawn on the graph — a
			// consultant label whose last citation was purged stays review-only.
			graphEligible: label.claim.value !== null,
		};
	});

	const edges: Edge[] = [];
	for (const edge of session.workflow.edges) {
		const evidence = edge.evidence.filter(stillValid);
		collectStaleQuotes(edge.evidence);
		const condition = stripClaimCitations(edge.condition, stillValid);
		recordConsultantLosses(edge.id, `edge '${edge.id}'`, [
			{ field: 'condition', stripped: condition },
		], lostNotices);
		if (
			evidence.length === 0
			|| (edge.kind !== 'sequence' && condition.claim.value === null)
		) {
			lostNotices.push({
				code: 'lost_evidence',
				targetId: edge.id,
				message: `Edge '${edge.id}' lost its cited source support and was removed.`,
			});
			continue;
		}
		edges.push({ ...edge, evidence, condition: condition.claim });
	}

	const opportunities: Opportunity[] = [];
	const droppedOpportunityIds: string[] = [];
	for (const opportunity of session.opportunities) {
		const evidence = opportunity.evidence.filter(stillValid);
		collectStaleQuotes(opportunity.evidence);
		if (evidence.length === 0) {
			droppedOpportunityIds.push(opportunity.id);
			lostNotices.push({
				code: 'lost_evidence',
				targetId: opportunity.id,
				message: `Opportunity '${opportunity.id}' lost all of its cited evidence and was removed together with its proposal.`,
			});
			continue;
		}
		const impact = stripClaimCitations(opportunity.factors.impact, stillValid);
		const frequency = stripClaimCitations(
			opportunity.factors.frequency,
			stillValid,
		);
		const effort = stripClaimCitations(opportunity.factors.effort, stillValid);
		const feasibility = stripClaimCitations(
			opportunity.factors.feasibility,
			stillValid,
		);
		const risk = stripClaimCitations(opportunity.factors.risk, stillValid);
		recordConsultantLosses(opportunity.id, `opportunity '${opportunity.id}'`, [
			{ field: 'impact', stripped: impact },
			{ field: 'frequency', stripped: frequency },
			{ field: 'effort', stripped: effort },
			{ field: 'feasibility', stripped: feasibility },
			{ field: 'risk', stripped: risk },
		], lostNotices);
		const monthlyOccurrences = {
			...opportunity.assumptions.monthlyOccurrences,
			evidence:
				opportunity.assumptions.monthlyOccurrences.evidence.filter(
					stillValid,
				),
		};
		const minutesSaved = {
			...opportunity.assumptions.minutesSaved,
			evidence:
				opportunity.assumptions.minutesSaved.evidence.filter(stillValid),
		};
		collectStaleQuotes(opportunity.assumptions.monthlyOccurrences.evidence);
		collectStaleQuotes(opportunity.assumptions.minutesSaved.evidence);
		opportunities.push({
			...opportunity,
			evidence,
			factors: {
				impact: impact.claim,
				frequency: frequency.claim,
				effort: effort.claim,
				feasibility: feasibility.claim,
				risk: risk.claim,
			},
			assumptions: { monthlyOccurrences, minutesSaved },
		});
	}

	const proposals = sanitizeProposals(
		session.proposals,
		droppedOpportunityIds,
		stillValid,
		collectStaleQuotes,
		staleQuoteSet,
		lostNotices,
	);

	return {
		steps,
		edges,
		opportunities,
		proposals,
		droppedOpportunityIds,
		lostNotices,
		staleQuotes: [...staleQuoteSet],
	};
}

type StrippedField = {
	field: string;
	stripped: { lostConsultantValue: string | null };
};

/** Surface a fully purged consultant value as a review-only notice. */
function recordConsultantLosses(
	targetId: string,
	subject: string,
	fields: readonly StrippedField[],
	lostNotices: ReviewNotice[],
): void {
	for (const { field, stripped } of fields) {
		if (stripped.lostConsultantValue !== null) {
			lostNotices.push({
				code: 'lost_evidence',
				targetId,
				message: `Consultant correction '${stripped.lostConsultantValue}' for ${subject} ${field} lost its cited source support and is kept for review.`,
			});
		}
	}
}

function sanitizeProposals(
	proposals: readonly Proposal[],
	droppedOpportunityIds: readonly string[],
	stillValid: StillValid,
	collectStaleQuotes: (
		refs: readonly { sourceId: string; sourceRev: number; quote: string }[],
	) => void,
	staleQuoteSet: ReadonlySet<string>,
	lostNotices: ReviewNotice[],
): Proposal[] {
	const sanitized: Proposal[] = [];
	for (const proposal of proposals) {
		// The opportunity lost all of its evidence and was removed; the
		// proposal goes with it.
		if (droppedOpportunityIds.includes(proposal.opportunityId)) {
			continue;
		}
		const keptSteps: Proposal['graph']['steps'] = [];
		const droppedStepIds = new Set<string>();
		for (const pstep of proposal.graph.steps) {
			const evidence = pstep.evidence.filter(stillValid);
			collectStaleQuotes(pstep.evidence);
			if (evidence.length === 0) {
				// A proposed step is a cited hypothesis; the schema requires at
				// least one evidence reference, so an unsupported one cannot
				// persist.
				droppedStepIds.add(pstep.id);
				lostNotices.push({
					code: 'lost_evidence',
					targetId: proposal.opportunityId,
					message: `Proposed step '${pstep.id}' lost its cited source support and was removed from the proposal.`,
				});
				continue;
			}
			keptSteps.push({ ...pstep, evidence });
		}
		const keptEdges: Proposal['graph']['edges'] = [];
		for (const pedge of proposal.graph.edges) {
			const evidence = pedge.evidence.filter(stillValid);
			collectStaleQuotes(pedge.evidence);
			const dangling =
				droppedStepIds.has(pedge.fromStepId)
				|| droppedStepIds.has(pedge.toStepId);
			if (evidence.length === 0) {
				lostNotices.push({
					code: 'lost_evidence',
					targetId: proposal.opportunityId,
					message: `Proposed edge '${pedge.id}' lost its cited source support and was removed from the proposal.`,
				});
				continue;
			}
			if (dangling) {
				lostNotices.push({
					code: 'lost_evidence',
					targetId: proposal.opportunityId,
					message: `Proposed edge '${pedge.id}' referenced a removed proposed step and was removed from the proposal.`,
				});
				continue;
			}
			keptEdges.push({ ...pedge, evidence });
		}
		if (proposal.graph.steps.length > 0 && keptSteps.length === 0) {
			lostNotices.push({
				code: 'lost_evidence',
				targetId: proposal.opportunityId,
				message: `The proposal for opportunity '${proposal.opportunityId}' lost all of its supported steps and was removed.`,
			});
			continue;
		}
		sanitized.push({
			...proposal,
			graph: { steps: keptSteps, edges: keptEdges },
		});
	}
	// Plan sections may quote source text verbatim; scrub copies of every
	// quote that no longer validates, whatever proposal it sits in.
	return sanitized.map((proposal) => ({
		...proposal,
		plan: {
			...proposal.plan,
			sections: scrubPlanSections(proposal.plan.sections, staleQuoteSet),
		},
	}));
}

/**
 * Remove verbatim copies of moved source text from plan section prose. Only
 * exact copies of a quote that no longer validates are deleted; arbitrary
 * plan prose that paraphrases or discusses the source is left untouched for
 * consultant review. The distinction matters: quoted source text is evidence
 * whose stale copies must not persist, while the plan's own wording is
 * content only a person should revise.
 */
function scrubPlanSections(
	sections: Plan['sections'],
	staleQuotes: ReadonlySet<string>,
): Plan['sections'] {
	let scrubbed = sections;
	for (const quote of staleQuotes) {
		for (const section of PLAN_SECTIONS) {
			const text = scrubbed[section];
			if (text.includes(quote)) {
				scrubbed = { ...scrubbed, [section]: text.split(quote).join('') };
			}
		}
	}
	return scrubbed;
}

/** Merge cascade losses into a session's review notices without duplicates. */
export function withLostNotices(
	notices: ReviewNotice[],
	lostNotices: ReviewNotice[],
): ReviewNotice[] {
	const seen = new Set(
		notices.map((notice) => `${notice.code}|${notice.message}`),
	);
	return [
		...notices,
		...lostNotices.filter(
			(notice) => !seen.has(`${notice.code}|${notice.message}`),
		),
	];
}
