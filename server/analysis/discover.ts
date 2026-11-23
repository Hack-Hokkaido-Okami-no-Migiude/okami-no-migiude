// Discovery pipeline: project a bounded provider input, run the extract and
// assess stages, then reconcile validated candidates into session fields.
// Evidence is re-verified locally against the session's own sources; ambiguous
// transitions are omitted from the graph and surfaced as review notices.
import type { AssessOutput, ExtractOutput } from '../../shared/p0/stages';
import type {
	DiscoveryPatch,
	Edge,
	Graph,
	Opportunity,
	Question,
	ReviewNotice,
	Session,
	Step,
} from '../../shared/p0/types';
import {
	buildSourceIndex,
	checkTransitionProvenance,
	parseAssessOutput,
	parseExtractOutput,
	resolveEvidence,
} from './validate';
import type { AnalysisProvider } from './provider';
import { StageError } from '../../shared/p0/stages';
import { projectExtractInput } from './project';
import { runKey } from './keys';

export type DiscoveryResult = { patch: DiscoveryPatch; artifactKey: string };

const INFERENCE_LABEL = 'Inferred from the cited interview text.';
const FACTOR_NAMES = [
	'impact',
	'frequency',
	'effort',
	'feasibility',
	'risk',
] as const;

export async function discover(
	session: Session,
	provider: AnalysisProvider,
): Promise<DiscoveryResult> {
	const extractInput = projectExtractInput(session, provider);
	const extraction = parseExtractOutput(
		await provider.run('extract', extractInput),
	);

	const sources = buildSourceIndex(session);
	validateAllEvidence(extraction, sources);

	const assessment = parseAssessOutput(
		await provider.run('assess', {
			variant: extractInput.variant,
			clientId: extractInput.clientId,
			sessionId: extractInput.sessionId,
			sources: [...sources].map(([sourceId, source]) => ({
				id: sourceId,
				sourceRev: source.sourceRev,
				text: source.text,
			})),
			extraction,
		}),
	);
	assertKnownAssessmentKeys(assessment, extraction);

	const patch = reconcile(session, extraction, assessment, provider.mode);
	return { patch, artifactKey: runKey(session, 'discover', provider) };
}

function assertKnownAssessmentKeys(
	assessment: AssessOutput,
	extraction: ExtractOutput,
): void {
	const candidateKeys = new Set(
		extraction.transitions.map((transition) => transition.key),
	);
	for (const acceptedKey of assessment.acceptedTransitionKeys) {
		if (!candidateKeys.has(acceptedKey)) {
			throw new StageError(
				'invalid_model_output',
				`Assessment accepted unknown transition '${acceptedKey}'.`,
			);
		}
	}
	for (const rejected of assessment.rejected) {
		if (!candidateKeys.has(rejected.key)) {
			throw new StageError(
				'invalid_model_output',
				`Assessment rejected unknown transition '${rejected.key}'.`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Evidence gate
// ---------------------------------------------------------------------------

function validateAllEvidence(
	extraction: ExtractOutput,
	sources: ReturnType<typeof buildSourceIndex>,
): void {
	for (const step of extraction.steps) {
		for (const candidate of step.evidence) {
			resolveEvidence(candidate, sources);
		}
	}
	for (const transition of extraction.transitions) {
		resolveEvidence(transition.evidence, sources);
	}
	for (const opportunity of extraction.opportunities) {
		for (const candidate of opportunity.evidence) {
			resolveEvidence(candidate, sources);
		}
		for (const factor of opportunity.factors) {
			resolveEvidence(factor.evidence, sources);
		}
		for (const assumption of opportunity.assumptions) {
			resolveEvidence(assumption.evidence, sources);
		}
	}
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function reconcile(
	session: Session,
	extraction: ExtractOutput,
	assessment: AssessOutput,
	providerMode: 'fixture' | 'live',
): DiscoveryPatch {
	const notices = new Map<string, ReviewNotice>();
	const addNotice = (notice: ReviewNotice) => {
		notices.set(`${notice.code}|${notice.message}`, notice);
	};

	const { steps, resolvedSteps } = reconcileSteps(
		session.workflow,
		extraction,
		addNotice,
	);
	const edges = reconcileEdges(
		session.workflow,
		extraction,
		assessment,
		resolvedSteps,
		addNotice,
	);
	const questions = reconcileQuestions(
		session.questions,
		extraction,
		resolvedSteps,
	);
	const opportunities = reconcileOpportunities(
		session.opportunities,
		extraction,
		resolvedSteps,
		addNotice,
	);

	return {
		workflow: { steps, edges },
		questions,
		opportunities,
		discovery: {
			mode: providerMode,
			completedAt: new Date().toISOString(),
			stale: false,
		},
		reviewNotices: [...notices.values()],
	};
}

/** Resolution of one extraction step candidate against the persisted graph. */
type ResolvedStep =
	{ key: string; id: string } | { key: string; omitted: true };

/**
 * Merge extracted steps into the persisted graph: reuse ids for matched steps,
 * never overwrite consultant-verified claims, and drop unmatched analysis-only
 * steps (their edges disappear with them).
 */
function reconcileSteps(
	existingGraph: Graph,
	extraction: ExtractOutput,
	addNotice: (notice: ReviewNotice) => void,
): { steps: Step[]; resolvedSteps: Map<string, ResolvedStep> } {
	const steps: Step[] = [];
	const resolvedSteps = new Map<string, ResolvedStep>();
	const usedIds = new Set<string>();

	for (const candidate of extraction.steps) {
		if (usedIds.has(candidate.key)) {
			throw new StageError(
				'invalid_model_output',
				`Duplicate local key '${candidate.key}' in extraction.`,
			);
		}
		const match = matchExistingStep(candidate, existingGraph);
		if (match === 'ambiguous') {
			addNotice({
				code: 'ambiguous_match',
				targetId: null,
				message: `Extracted step '${candidate.label}' matches multiple existing steps and was omitted.`,
			});
			resolvedSteps.set(candidate.key, {
				key: candidate.key,
				omitted: true,
			});
			continue;
		}
		const id = match ?? candidate.key;
		usedIds.add(id);
		const previous = existingGraph.steps.find((step) => step.id === id);
		steps.push(buildStep(candidate, previous));
		resolvedSteps.set(candidate.key, { key: candidate.key, id });
	}

	// Unmatched persisted steps survive only if a consultant verified them.
	for (const step of existingGraph.steps) {
		if (!usedIds.has(step.id) && hasConsultantVerifiedClaims(step)) {
			steps.push(step);
		}
	}
	return { steps, resolvedSteps };
}

function matchExistingStep(
	candidate: ExtractOutput['steps'][number],
	existingGraph: Graph,
): string | 'ambiguous' | undefined {
	if (existingGraph.steps.some((step) => step.id === candidate.key)) {
		return candidate.key;
	}
	const anchorMatches = existingGraph.steps.filter((step) =>
		candidate.anchors.some((anchor) =>
			stepEvidenceQuotes(step).some((quote) => quote.includes(anchor)),
		),
	);
	const [onlyMatch] = anchorMatches;
	if (anchorMatches.length === 1 && onlyMatch) {
		return onlyMatch.id;
	}
	return anchorMatches.length > 1 ? 'ambiguous' : undefined;
}

function stepEvidenceQuotes(step: Step): string[] {
	return [
		step.label,
		step.role,
		step.tool,
		step.bottleneck,
		step.exception,
	].flatMap((claim) => claim.evidence.map((reference) => reference.quote));
}

function buildStep(
	candidate: ExtractOutput['steps'][number],
	previous: Step | undefined,
): Step {
	const evidence = candidate.evidence.map((reference) => ({
		sourceId: reference.sourceId,
		sourceRev: reference.sourceRev,
		quote: reference.quote,
	}));
	const isVerified = (claim?: { state: string }) =>
		claim?.state === 'consultant-verified';
	const previousLabel = previous?.label;
	const verifiedLabel =
		(
			previousLabel
			&& isVerified(previousLabel)
			&& previousLabel.value === candidate.label
		) ?
			previousLabel
		:	undefined;
	const previousRole = previous?.role;
	const previousTool = previous?.tool;
	const previousExecution = previous?.execution;
	return {
		id: previous?.id ?? candidate.key,
		label: verifiedLabel ?? inferredClaim(candidate.label, evidence),
		role:
			(
				candidate.role !== null
				&& !(previousRole && isVerified(previousRole))
			) ?
				inferredClaim(candidate.role, evidence)
			:	(previousRole ?? unknownClaim()),
		tool:
			(
				candidate.tool !== null
				&& !(previousTool && isVerified(previousTool))
			) ?
				inferredClaim(candidate.tool, evidence)
			:	(previousTool ?? unknownClaim()),
		inputs:
			previous && isVerified(previous.inputs) ?
				previous.inputs
			:	unknownListClaim(),
		outputs:
			previous && isVerified(previous.outputs) ?
				previous.outputs
			:	unknownListClaim(),
		execution:
			(
				candidate.execution !== null
				&& !(previousExecution && isVerified(previousExecution))
			) ?
				inferredClaim(candidate.execution, evidence)
			:	(previousExecution ?? unknownClaim()),
		bottleneck: previous?.bottleneck ?? unknownClaim(),
		exception: previous?.exception ?? unknownClaim(),
		graphEligible: candidate.label.trim().length > 0,
	};
}

function hasConsultantVerifiedClaims(step: Step): boolean {
	const claims = [
		step.label,
		step.role,
		step.tool,
		step.inputs,
		step.outputs,
		step.execution,
		step.bottleneck,
		step.exception,
	];
	return claims.some((claim) => claim.state === 'consultant-verified');
}

function reconcileEdges(
	existingGraph: Graph,
	extraction: ExtractOutput,
	assessment: AssessOutput,
	resolvedSteps: Map<string, ResolvedStep>,
	addNotice: (notice: ReviewNotice) => void,
): Edge[] {
	const acceptedKeys = new Set(assessment.acceptedTransitionKeys);
	const rejectedKeys = new Map(
		assessment.rejected.map((entry) => [entry.key, entry]),
	);
	const labelByKey = new Map(
		extraction.steps.map((step) => [step.key, step.label]),
	);
	const edges: Edge[] = [];
	const usedTriples = new Set<string>();

	for (const candidate of extraction.transitions) {
		const fromStep = resolvedSteps.get(candidate.fromKey);
		const toStep = resolvedSteps.get(candidate.toKey);
		if (!fromStep || !toStep) {
			throw new StageError(
				'invalid_model_output',
				`Transition '${candidate.key}' references a step outside the extraction.`,
			);
		}
		if ('omitted' in fromStep || 'omitted' in toStep) {
			addNotice({
				code: 'ambiguous_match',
				targetId: null,
				message: `Transition '${candidate.key}' was omitted because one of its steps could not be resolved.`,
			});
			continue;
		}

		const providerRejection = rejectedKeys.get(candidate.key);
		const provenance = checkTransitionProvenance({
			quote: candidate.evidence.quote,
			fromAnchor: candidate.fromAnchor,
			toAnchor: candidate.toAnchor,
		});
		if (providerRejection || !provenance.accepted) {
			const fromLabel =
				labelByKey.get(candidate.fromKey) ?? candidate.fromKey;
			const toLabel = labelByKey.get(candidate.toKey) ?? candidate.toKey;
			const rejectionDetail =
				providerRejection?.detail
				?? (provenance.accepted ?
					'The assessment rejected this candidate.'
				:	provenance.detail);
			addNotice({
				code: 'ambiguous_match',
				targetId: null,
				message: `Candidate transition between '${fromLabel}' and '${toLabel}' was omitted: ${rejectionDetail}`,
			});
			continue;
		}
		if (!acceptedKeys.has(candidate.key)) {
			// The provider never assessed this candidate, so it stays unsupported.
			addNotice({
				code: 'lost_evidence',
				targetId: null,
				message: `Transition '${candidate.key}' was not assessed and was omitted from the graph.`,
			});
			continue;
		}
		if (
			candidate.kind !== 'sequence'
			&& (candidate.condition === null
				|| candidate.condition.trim().length === 0)
		) {
			throw new StageError(
				'invalid_model_output',
				`Edge '${candidate.key}' of kind '${candidate.kind}' is missing its evidenced condition.`,
			);
		}

		const triple = `${fromStep.id}|${candidate.kind}|${toStep.id}`;
		if (usedTriples.has(triple)) {
			addNotice({
				code: 'ambiguous_match',
				targetId: null,
				message: `Duplicate transition '${candidate.key}' overlaps an existing edge and was omitted.`,
			});
			continue;
		}
		usedTriples.add(triple);

		const evidence = [
			{
				sourceId: candidate.evidence.sourceId,
				sourceRev: candidate.evidence.sourceRev,
				quote: candidate.evidence.quote,
			},
		];
		const existingEdge = existingGraph.edges.find(
			(edge) =>
				edge.fromStepId === fromStep.id
				&& edge.toStepId === toStep.id
				&& edge.kind === candidate.kind,
		);
		edges.push({
			id: existingEdge?.id ?? candidate.key,
			fromStepId: fromStep.id,
			toStepId: toStep.id,
			kind: candidate.kind,
			condition:
				(
					candidate.condition !== null
					&& candidate.condition.trim().length > 0
				) ?
					inferredClaim(
						candidate.condition,
						evidence,
						existingEdge?.condition,
					)
				:	(existingEdge?.condition ?? unknownClaim()),
			evidence,
		});
	}
	return edges;
}

function reconcileQuestions(
	existing: Question[],
	extraction: ExtractOutput,
	resolvedSteps: Map<string, ResolvedStep>,
): Question[] {
	const questions = [...existing];
	const seen = new Set(
		existing.map(
			(question) => `${question.targetStepId ?? ''}|${question.factKey}`,
		),
	);

	for (const candidate of extraction.unknowns) {
		const targetStepId =
			candidate.stepKey === null ?
				null
			:	resolvedStepIdOrNull(
					resolvedSteps,
					candidate.stepKey,
					candidate.key,
				);
		const compositeKey = `${targetStepId ?? ''}|${candidate.factKey}`;
		if (seen.has(compositeKey)) {
			// Same reconciled target + fact key already exists (possibly answered):
			// keep its history instead of duplicating the question.
			continue;
		}
		seen.add(compositeKey);
		questions.push({
			id: candidate.key,
			targetStepId,
			factKey: candidate.factKey,
			prompt: candidate.prompt,
			whyItMatters: candidate.whyItMatters,
			priority: candidate.priority,
			status: 'open',
			answer: null,
		});
	}
	return questions;
}

function reconcileOpportunities(
	existing: Opportunity[],
	extraction: ExtractOutput,
	resolvedSteps: Map<string, ResolvedStep>,
	addNotice: (notice: ReviewNotice) => void,
): Opportunity[] {
	const opportunities = [...existing];

	for (const candidate of extraction.opportunities) {
		const stepIds = candidate.stepKeys.map((stepKey) =>
			resolvedStepIdOrNull(resolvedSteps, stepKey, candidate.key),
		);
		if (stepIds.some((stepId) => stepId === null)) {
			addNotice({
				code: 'ambiguous_match',
				targetId: null,
				message: `Opportunity '${candidate.title}' was omitted because one of its steps could not be resolved.`,
			});
			continue;
		}
		const sortedStepIds = [...stepIds].sort().join('|');
		const matches = existing.filter(
			(opportunity) =>
				opportunity.strategy === candidate.strategy
				&& [...opportunity.stepIds].sort().join('|') === sortedStepIds,
		);
		if (matches.length > 1) {
			const firstMatch = matches[0];
			addNotice({
				code: 'ambiguous_match',
				targetId: firstMatch ? firstMatch.id : null,
				message: `Extracted opportunity '${candidate.title}' matches multiple existing opportunities and was omitted.`,
			});
			continue;
		}
		if (matches.length === 1) {
			continue;
		}

		const assumptions = buildAssumptions(candidate.assumptions);
		opportunities.push({
			id: candidate.key,
			title: candidate.title,
			strategy: candidate.strategy,
			stepIds: stepIds as string[],
			evidence: candidate.evidence.map((reference) => ({ ...reference })),
			rationale: candidate.rationale,
			factors: buildFactorClaims(candidate.factors),
			benefits: [...candidate.benefits],
			prerequisites: [...candidate.prerequisites],
			risks: [...candidate.risks],
			unknowns: [...candidate.unknowns],
			assumptions,
			hoursSavedPerMonth: computeHoursSaved(assumptions),
		});
	}
	return opportunities;
}

function resolvedStepIdOrNull(
	resolvedSteps: Map<string, ResolvedStep>,
	stepKey: string,
	candidateKey: string,
): string | null {
	const resolved = resolvedSteps.get(stepKey);
	if (!resolved) {
		throw new StageError(
			'invalid_model_output',
			`Candidate '${candidateKey}' references a step outside the extraction ('${stepKey}').`,
		);
	}
	return 'omitted' in resolved ? null : resolved.id;
}

function buildFactorClaims(
	candidates: ExtractOutput['opportunities'][number]['factors'],
): Opportunity['factors'] {
	const byFactor = new Map(candidates.map((entry) => [entry.factor, entry]));
	if (byFactor.size !== candidates.length) {
		throw new StageError(
			'invalid_model_output',
			'Extraction lists the same opportunity factor twice.',
		);
	}
	const claims = {} as Opportunity['factors'];
	for (const factor of FACTOR_NAMES) {
		const entry = byFactor.get(factor);
		claims[factor] =
			entry ?
				inferredClaim(entry.level, [
					{
						sourceId: entry.evidence.sourceId,
						sourceRev: entry.evidence.sourceRev,
						quote: entry.evidence.quote,
					},
				])
			:	unknownClaim();
	}
	return claims;
}

function buildAssumptions(
	candidates: ExtractOutput['opportunities'][number]['assumptions'],
): Opportunity['assumptions'] {
	const notEstablished = {
		value: null,
		basis: 'Not yet established.',
		evidence: [],
		edited: false,
	};
	const assumptions: Opportunity['assumptions'] = {
		monthlyOccurrences: { ...notEstablished },
		minutesSaved: { ...notEstablished },
	};
	for (const candidate of candidates) {
		if (
			candidate.value !== null
			&& (!Number.isFinite(candidate.value) || candidate.value < 0)
		) {
			throw new StageError(
				'invalid_model_output',
				`Assumption '${candidate.which}' must be a finite nonnegative number.`,
			);
		}
		assumptions[candidate.which] = {
			value: candidate.value,
			basis: candidate.basis,
			evidence: [
				{
					sourceId: candidate.evidence.sourceId,
					sourceRev: candidate.evidence.sourceRev,
					quote: candidate.evidence.quote,
				},
			],
			edited: false,
		};
	}
	return assumptions;
}

/** occurrences × minutes ÷ 60; null when either input is missing, zero is valid. */
export function computeHoursSaved(assumptions: {
	monthlyOccurrences: { value: number | null };
	minutesSaved: { value: number | null };
}): number | null {
	const occurrences = assumptions.monthlyOccurrences.value;
	const minutes = assumptions.minutesSaved.value;
	if (occurrences === null || minutes === null) {
		return null;
	}
	return (occurrences * minutes) / 60;
}

// ---------------------------------------------------------------------------
// Claim builders (never overwrite consultant-verified values)
// ---------------------------------------------------------------------------

function inferredClaim<TValue extends string>(
	value: TValue,
	evidence: { sourceId: string; sourceRev: number; quote: string }[],
	previous?: { state: string },
): {
	value: TValue | null;
	state: 'inferred';
	author: 'analysis';
	evidence: { sourceId: string; sourceRev: number; quote: string }[];
	inference: string;
} {
	if (previous?.state === 'consultant-verified') {
		return previous as unknown as ReturnType<typeof inferredClaim<TValue>>;
	}
	return {
		value,
		state: 'inferred',
		author: 'analysis',
		evidence: evidence.map((reference) => ({ ...reference })),
		inference: INFERENCE_LABEL,
	};
}

function unknownClaim<TValue extends string>(previous?: {
	state: string;
}): {
	value: TValue | null;
	state: 'unknown';
	author: 'analysis';
	evidence: [];
} {
	if (previous?.state === 'consultant-verified') {
		return previous as unknown as {
			value: TValue | null;
			state: 'unknown';
			author: 'analysis';
			evidence: [];
		};
	}
	return { value: null, state: 'unknown', author: 'analysis', evidence: [] };
}

function unknownListClaim(): {
	value: string[] | null;
	state: 'unknown';
	author: 'analysis';
	evidence: [];
} {
	return { value: null, state: 'unknown', author: 'analysis', evidence: [] };
}
