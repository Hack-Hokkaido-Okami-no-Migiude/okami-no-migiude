// Edge reconciliation: a transition becomes a persisted edge only when the
// assessment accepted it AND the server's own provenance check passes (explicit
// trigger/handoff/sequence phrase plus both endpoint anchors in the cited
// quote). Rejected or unsupported candidates are omitted from the graph and
// surfaced as review notices — endpoint co-occurrence alone never creates an edge.
import type { AssessOutput, ExtractOutput } from '../../shared/p0/stages';
import type {
	Edge,
	EvidenceRef,
	Graph,
	ReviewNotice,
} from '../../shared/p0/types';
import { assertLocalKeyPrefix, checkTransitionProvenance } from './validate';
import { inferredClaim, unknownClaim } from './claims';
import type { ResolvedStep } from './reconcile-steps';
import { StageError } from '../../shared/p0/stages';

export function reconcileEdges(
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
	const usedNewIds = new Set<string>();

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
		assertLocalKeyPrefix(candidate.key, 'edge', 'extracted transition');

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

		const evidence: EvidenceRef[] = [
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
		if (!existingEdge) {
			// A new edge id must not collide with a persisted edge that connects
			// different endpoints, and candidate keys must stay unique.
			if (existingGraph.edges.some((edge) => edge.id === candidate.key)) {
				throw new StageError(
					'invalid_model_output',
					`Transition '${candidate.key}' collides with an existing edge id for different endpoints.`,
				);
			}
			if (usedNewIds.has(candidate.key)) {
				throw new StageError(
					'invalid_model_output',
					`Duplicate local key '${candidate.key}' in extraction transitions.`,
				);
			}
			usedNewIds.add(candidate.key);
		}
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
					inferredClaim(candidate.condition, evidence)
				:	(existingEdge?.condition ?? unknownClaim<string>()),
			evidence,
		});
	}
	return edges;
}
