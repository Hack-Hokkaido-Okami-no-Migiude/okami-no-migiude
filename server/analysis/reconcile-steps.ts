// Step reconciliation: merge extraction candidates into the persisted graph.
// Steps are matched by validated prior id or a unique evidence anchor; unmatched
// consultant-supported steps survive as review-only, while unmatched
// analysis-only steps are dropped together with their edges.
import type { Graph, ReviewNotice, Step } from '../../shared/p0/types';
import { inferredClaim, preservedClaim, unknownClaim } from './claims';
import type { ExtractOutput } from '../../shared/p0/stages';
import { StageError } from '../../shared/p0/stages';
import { assertLocalKeyPrefix } from './validate';

/** Resolution of one extraction step candidate against the persisted graph. */
export type ResolvedStep =
	{ key: string; id: string } | { key: string; omitted: true };

/**
 * Merge extracted steps into the persisted graph: reuse ids for matched steps,
 * never overwrite consultant-authored or verified claims, and drop unmatched
 * analysis-only steps (their edges disappear with them).
 */
export function reconcileSteps(
	existingGraph: Graph,
	extraction: ExtractOutput,
	addNotice: (notice: ReviewNotice) => void,
): { steps: Step[]; resolvedSteps: Map<string, ResolvedStep> } {
	const steps: Step[] = [];
	const resolvedSteps = new Map<string, ResolvedStep>();
	const usedKeys = new Set<string>();
	const usedIds = new Set<string>();

	for (const candidate of extraction.steps) {
		if (usedKeys.has(candidate.key)) {
			throw new StageError(
				'invalid_model_output',
				`Duplicate local key '${candidate.key}' in extraction.`,
			);
		}
		usedKeys.add(candidate.key);
		assertLocalKeyPrefix(candidate.key, 'step', 'extracted step');
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
		if (usedIds.has(id)) {
			throw new StageError(
				'invalid_model_output',
				`Two extraction candidates resolve to the same step '${id}'.`,
			);
		}
		usedIds.add(id);
		const previous = existingGraph.steps.find((step) => step.id === id);
		steps.push(buildStep(candidate, previous));
		resolvedSteps.set(candidate.key, { key: candidate.key, id });
	}

	// Unmatched persisted steps survive only when a consultant supported them;
	// they stay visible as review-only instead of being drawn as current work.
	for (const step of existingGraph.steps) {
		if (usedIds.has(step.id) || !hasPreservedClaims(step)) {
			continue;
		}
		steps.push({ ...step, graphEligible: false });
		addNotice({
			code: 'lost_evidence',
			targetId: step.id,
			message: `Step '${stepLabel(step)}' is no longer supported by the current extraction and was kept as review-only.`,
		});
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
		...reference,
	}));
	const label =
		preservedClaim(previous?.label)
		?? inferredClaim(candidate.label, evidence);
	return {
		id: previous?.id ?? candidate.key,
		label,
		role:
			preservedClaim(previous?.role)
			?? (candidate.role !== null ?
				inferredClaim(candidate.role, evidence)
			:	unknownClaim<string>()),
		tool:
			preservedClaim(previous?.tool)
			?? (candidate.tool !== null ?
				inferredClaim(candidate.tool, evidence)
			:	unknownClaim<string>()),
		inputs: preservedClaim(previous?.inputs) ?? unknownClaim<string[]>(),
		outputs: preservedClaim(previous?.outputs) ?? unknownClaim<string[]>(),
		execution:
			preservedClaim(previous?.execution)
			?? (candidate.execution !== null ?
				inferredClaim(candidate.execution, evidence)
			:	unknownClaim<'manual' | 'automated' | 'mixed'>()),
		bottleneck:
			preservedClaim(previous?.bottleneck) ?? unknownClaim<string>(),
		exception:
			preservedClaim(previous?.exception) ?? unknownClaim<string>(),
		// A step without a known label cannot be drawn on the graph. A purged
		// or consultant-cleared label keeps the step review-only even when the
		// fresh extraction re-derives a label for it.
		graphEligible: label.value !== null,
	};
}

export function hasPreservedClaims(step: Step): boolean {
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
	return claims.some((claim) => preservedClaim(claim) !== undefined);
}

function stepLabel(step: Step): string {
	return step.label.value ?? step.id;
}
