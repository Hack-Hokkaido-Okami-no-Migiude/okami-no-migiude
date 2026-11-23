// Input projection: build the bounded provider payloads from a session.
// The projection is deliberately narrow — ordered source rows, saved answers,
// known-record hints, and (for proposals) the affected opportunity and graph.
import type { EvidenceRef, Session, Step } from '../../shared/p0/types';
import type { AnalysisProvider } from './provider';
import { buildSourceIndex } from './validate';

/**
 * For fixture providers the variant is the provider key (the approved fixture
 * variant id); live providers run unbound against the generic contract.
 */
function variantFor(provider: AnalysisProvider): string {
	return provider.mode === 'fixture' ? provider.key : 'live-unbound';
}

export function projectExtractInput(
	session: Session,
	provider: AnalysisProvider,
) {
	return {
		variant: variantFor(provider),
		clientId: session.clientId,
		sessionId: session.id,
		transcript: session.transcript ?? { source: 'paste', segments: [] },
		answers: session.questions.flatMap((question) =>
			question.answer ?
				[
					{
						questionId: question.id,
						factKey: question.factKey,
						targetStepId: question.targetStepId,
						// The persisted answer identity: a live provider cites the
						// saved answer as evidence by id and revision.
						answerId: question.answer.id,
						answerRev: question.answer.sourceRev,
						text: question.answer.text,
					},
				]
			:	[],
		),
		hints: session.workflow.steps.map((step) => ({
			id: step.id,
			label: claimText(step.label),
		})),
	};
}

/** Project the sources a proposal is allowed to see: everything the current
 *  opportunity and graph actually cite, in stable order. */
export function projectProposeInput(
	session: Session,
	opportunityId: string,
	provider: AnalysisProvider,
) {
	const opportunity = session.opportunities.find(
		(entry) => entry.id === opportunityId,
	);
	if (!opportunity) {
		throw new Error(
			`Opportunity '${opportunityId}' not found; the route must check this first.`,
		);
	}
	const cited = new Set<string>();
	for (const reference of citedEvidence(opportunity)) {
		cited.add(reference.sourceId);
	}
	for (const step of session.workflow.steps) {
		for (const claim of [
			step.label,
			step.role,
			step.tool,
			step.bottleneck,
			step.exception,
		]) {
			for (const reference of claim.evidence) {
				cited.add(reference.sourceId);
			}
		}
	}
	for (const edge of session.workflow.edges) {
		for (const reference of edge.evidence) {
			cited.add(reference.sourceId);
		}
	}

	const sources = [...buildSourceIndex(session)]
		.filter(([sourceId]) => cited.has(sourceId))
		.map(([sourceId, source]) => ({
			id: sourceId,
			sourceRev: source.sourceRev,
			text: source.text,
		}));

	return {
		variant: variantFor(provider),
		clientId: session.clientId,
		sessionId: session.id,
		opportunity,
		graph: session.workflow,
		sources,
	};
}

function citedEvidence(
	opportunity: Session['opportunities'][number],
): EvidenceRef[] {
	const factorEvidence = Object.values(opportunity.factors).flatMap(
		(claim) => claim.evidence,
	);
	const assumptionEvidence = [
		opportunity.assumptions.monthlyOccurrences,
		opportunity.assumptions.minutesSaved,
	].flatMap((assumption) => assumption.evidence);
	return [...opportunity.evidence, ...factorEvidence, ...assumptionEvidence];
}

function claimText(claim: Step['label']): string {
	return claim.value ?? 'unknown';
}
