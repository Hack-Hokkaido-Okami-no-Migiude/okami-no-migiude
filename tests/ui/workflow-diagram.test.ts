import type { Graph, Step } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import test from 'node:test';

const evidence = [
	{ sourceId: 'seg_test', sourceRev: 1, quote: 'file the report' },
];
const label = {
	value: 'File report',
	state: 'client-confirmed',
	author: 'analysis',
	evidence,
} as const;
const unknown = {
	value: null,
	state: 'unknown',
	author: 'analysis',
	evidence: [],
} as const;

function step(id: string, overrides: Partial<Step['label']> = {}): Step {
	return {
		id,
		label: { ...label, ...overrides },
		graphEligible: true,
		role: { ...unknown, evidence: [] },
		tool: { ...unknown, evidence: [] },
		inputs: { ...unknown, evidence: [] },
		outputs: { ...unknown, evidence: [] },
		execution: { ...unknown, evidence: [] },
		bottleneck: { ...unknown, evidence: [] },
		exception: { ...unknown, evidence: [] },
	};
}

test('current diagram omits unsupported nodes and does not infer edges from layout order', async () => {
	const { currentDiagram } =
		await import('../../app/composables/workflowDiagrams');
	const graph: Graph = {
		steps: [
			step('step_file'),
			{ ...step('step_review'), graphEligible: false },
			step('step_check'),
			step('step_unproven', { evidence: [] }),
		],
		edges: [
			{
				id: 'edge_bad',
				fromStepId: 'step_file',
				toStepId: 'step_review',
				condition: { ...unknown, evidence: [] },
				kind: 'sequence',
				evidence,
			},
		],
	};
	const diagram = currentDiagram(graph);
	assert.deepEqual(
		diagram.nodes.map(({ id }) => id),
		['step_file', 'step_check'],
	);
	assert.deepEqual(diagram.edges, []);
});
