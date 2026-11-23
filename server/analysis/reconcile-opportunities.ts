// Opportunity reconciliation: merge extraction opportunities into the persisted
// list by affected steps + strategy, prune references to steps that vanished,
// keep manual assumption edits, and rank the result (known-factor mean with
// effort/risk inverted, ties by known count then id).
import type { Opportunity, ReviewNotice } from '../../shared/p0/types';
import { inferredClaim, unknownClaim } from './claims';
import type { ExtractOutput } from '../../shared/p0/stages';
import { FACTOR_NAMES } from '../../shared/p0/schemas';
import type { ResolvedStep } from './reconcile-steps';
import { StageError } from '../../shared/p0/stages';
import { assertLocalKeyPrefix } from './validate';
import { rankOpportunities } from './ranking';

export function reconcileOpportunities(
	existing: Opportunity[],
	extraction: ExtractOutput,
	resolvedSteps: Map<string, ResolvedStep>,
	survivingStepIds: ReadonlySet<string>,
	addNotice: (notice: ReviewNotice) => void,
): Opportunity[] {
	const opportunities = pruneOrphaned(existing, survivingStepIds, addNotice);
	const usedKeys = new Set<string>();

	for (const candidate of extraction.opportunities) {
		if (usedKeys.has(candidate.key)) {
			throw new StageError(
				'invalid_model_output',
				`Duplicate local key '${candidate.key}' in extraction opportunities.`,
			);
		}
		usedKeys.add(candidate.key);
		assertLocalKeyPrefix(candidate.key, 'opp', 'extracted opportunity');

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
		const matches = opportunities.filter(
			(opportunity) =>
				opportunity.strategy === candidate.strategy
				&& [...opportunity.stepIds].sort().join('|') === sortedStepIds,
		);
		if (matches.length > 1) {
			const [firstMatch] = matches;
			addNotice({
				code: 'ambiguous_match',
				targetId: firstMatch ? firstMatch.id : null,
				message: `Extracted opportunity '${candidate.title}' matches multiple existing opportunities and was omitted.`,
			});
			continue;
		}
		if (matches.length === 1) {
			// The existing opportunity stays authoritative; re-analysis does not
			// overwrite its cited rationale, factors, or manual assumption edits.
			continue;
		}
		if (
			opportunities.some(
				(opportunity) => opportunity.id === candidate.key,
			)
		) {
			throw new StageError(
				'invalid_model_output',
				`Local key '${candidate.key}' collides with an existing opportunity id.`,
			);
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
	return rankOpportunities(opportunities);
}

/** Drop references to vanished steps; an opportunity left with none is removed. */
function pruneOrphaned(
	existing: Opportunity[],
	survivingStepIds: ReadonlySet<string>,
	addNotice: (notice: ReviewNotice) => void,
): Opportunity[] {
	const pruned: Opportunity[] = [];
	for (const opportunity of existing) {
		const keptStepIds = opportunity.stepIds.filter((stepId) =>
			survivingStepIds.has(stepId),
		);
		if (keptStepIds.length === opportunity.stepIds.length) {
			pruned.push(opportunity);
			continue;
		}
		if (keptStepIds.length === 0) {
			addNotice({
				code: 'lost_evidence',
				targetId: opportunity.id,
				message: `Opportunity '${opportunity.title}' lost all of its steps and was removed together with its proposal.`,
			});
			continue;
		}
		pruned.push({ ...opportunity, stepIds: keptStepIds });
		addNotice({
			code: 'lost_evidence',
			targetId: opportunity.id,
			message: `Opportunity '${opportunity.title}' no longer covers removed steps; its affected steps were updated.`,
		});
	}
	return pruned;
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
	const used = new Set<string>();
	for (const candidate of candidates) {
		if (used.has(candidate.which)) {
			throw new StageError(
				'invalid_model_output',
				`Extraction lists the '${candidate.which}' assumption twice.`,
			);
		}
		used.add(candidate.which);
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
