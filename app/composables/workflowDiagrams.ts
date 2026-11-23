import type {
	Edge,
	EvidenceRef,
	Graph,
	ProposedGraph,
} from '#shared/p0/types';
import { claimStateLabel } from './workbenchDescriptors';

export type DiagramNode = {
	id: string;
	label: string;
	detail: string;
	evidence: EvidenceRef[];
};
export type DiagramEdge = {
	id: string;
	fromStepId: string;
	toStepId: string;
	kind: Edge['kind'] | 'hypothesis';
	label: string | null;
	evidence: EvidenceRef[];
};
export type Diagram = { nodes: DiagramNode[]; edges: DiagramEdge[] };

export function currentDiagram(graph: Graph): Diagram {
	const nodes = graph.steps.flatMap((step) =>
		(
			step.graphEligible
			&& step.label.value?.trim()
			&& step.label.evidence.length
		) ?
			[
				{
					id: step.id,
					label: step.label.value,
					detail:
						step.role.value ?? claimStateLabel(step.label.state),
					evidence: step.label.evidence,
				},
			]
		:	[],
	);
	const nodeIds = new Set(nodes.map(({ id }) => id));
	const edges = graph.edges
		.filter(
			(edge) =>
				nodeIds.has(edge.fromStepId)
				&& nodeIds.has(edge.toStepId)
				&& edge.evidence.length
				&& (edge.kind === 'sequence'
					|| (edge.condition.value?.trim()
						&& edge.condition.evidence.length)),
		)
		.map((edge) => ({
			id: edge.id,
			fromStepId: edge.fromStepId,
			toStepId: edge.toStepId,
			kind: edge.kind,
			label: edge.condition.value,
			evidence: edge.evidence,
		}));
	return { nodes, edges };
}

export function proposedDiagram(
	graph: ProposedGraph,
	currentGraph: Graph,
): Diagram {
	const currentLabels = new Map(
		currentGraph.steps.map((step) => [step.id, step.label.value]),
	);
	return {
		nodes: graph.steps.map((step) => {
			const related = step.currentStepIds
				.map((id) => currentLabels.get(id))
				.filter(Boolean);
			return {
				id: step.id,
				label: step.label,
				detail:
					related.length ?
						`Relates to: ${related.join(' · ')}`
					:	'Proposed step',
				evidence: step.evidence,
			};
		}),
		edges: graph.edges.map((edge) => ({ ...edge, kind: 'hypothesis' })),
	};
}
