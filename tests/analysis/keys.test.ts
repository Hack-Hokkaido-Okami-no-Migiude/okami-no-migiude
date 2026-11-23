// Artifact keys: identical canonical content must produce identical keys, and
// every relevant input change (sources, answers, consultant overrides, and for
// proposals the graph/opportunity) must change the key — while timestamps,
// aggregate revs, and generated outputs must not.
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	stubProvider,
} from './helpers';
import type { AnalysisProvider } from '../../server/analysis/provider';
import type { Session } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import { discover } from '../../server/analysis/discover';
import { runKey } from '../../server/analysis/keys';
import test from 'node:test';

const provider: AnalysisProvider = stubProvider({});

test('the discovery key ignores rev bumps and timestamps', () => {
	const session = baseSession();
	assert.equal(
		runKey(session, 'discover', provider),
		runKey({ ...session, rev: 7 }, 'discover', provider),
	);
});

test('the discovery key follows transcript and answer content', () => {
	const session = baseSession();
	const editedTranscript: Session = {
		...session,
		transcript: {
			source: 'paste',
			segments:
				session.transcript?.segments.map((segment, index) =>
					index === 0 ?
						{ ...segment, text: `${segment.text} (edited)` }
					:	segment,
				) ?? [],
		},
	};
	assert.notEqual(
		runKey(session, 'discover', provider),
		runKey(editedTranscript, 'discover', provider),
	);

	const withAnswer: Session = {
		...session,
		questions: [
			{
				id: 'q_x',
				targetStepId: null,
				factKey: 'tool',
				prompt: 'Which tool?',
				whyItMatters: 'Integrations.',
				priority: 'high',
				status: 'answered',
				answer: { id: 'ans_x', sourceRev: 1, text: 'The PMS.' },
			},
		],
	};
	assert.notEqual(
		runKey(session, 'discover', provider),
		runKey(withAnswer, 'discover', provider),
	);
});

test('the discovery key follows consultant overrides but not analysis claims', async () => {
	const discovery = await discover(
		baseSession(),
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	const afterDiscovery: Session = {
		...baseSession(),
		...discovery.patch,
		rev: 2,
	};
	// Analysis-authored inferred claims must not change the discovery key —
	// otherwise no run after the first could be recognized as unchanged.
	assert.equal(
		runKey(baseSession(), 'discover', provider),
		runKey(afterDiscovery, 'discover', provider),
	);

	const corrected: Session = {
		...afterDiscovery,
		workflow: {
			...afterDiscovery.workflow,
			steps: afterDiscovery.workflow.steps.map((step) =>
				step.id === 'step_a' ?
					{
						...step,
						label: {
							...step.label,
							value: 'Receive reservation email (verified)',
							state: 'consultant-verified',
							author: 'consultant',
						},
					}
				:	step,
			),
		},
	};
	assert.notEqual(
		runKey(afterDiscovery, 'discover', provider),
		runKey(corrected, 'discover', provider),
	);
});

test('the proposal key follows the graph and the opportunity including assumptions', () => {
	const session = baseSession();
	const opportunityId = 'opp_x';
	assert.notEqual(
		runKey(session, 'discover', provider),
		runKey(session, 'propose', provider, opportunityId),
	);

	const changedGraph: Session = {
		...session,
		workflow: {
			steps: [
				{
					id: 'step_a',
					label: {
						value: 'Changed label',
						state: 'inferred',
						author: 'analysis',
						evidence: [],
						inference: 'label',
					},
					role: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					tool: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					inputs: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					outputs: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					execution: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					bottleneck: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					exception: {
						value: null,
						state: 'unknown',
						author: 'analysis',
						evidence: [],
					},
					graphEligible: true,
				},
			],
			edges: [],
		},
	};
	assert.notEqual(
		runKey(session, 'propose', provider, opportunityId),
		runKey(changedGraph, 'propose', provider, opportunityId),
	);
	// The discover key is unaffected by workflow-only changes.
	assert.equal(
		runKey(session, 'discover', provider),
		runKey(changedGraph, 'discover', provider),
	);
});
