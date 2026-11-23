// Discovery pipeline behavior: evidence-grounded reconciliation, the exact
// evidence rule for transitions, stable ids across re-analysis, preservation of
// consultant work, answered-question suppression, orphan handling, ranking, and
// rejection of malformed provider output. Runs entirely on scripted stubs.
import type {
	DiscoveryPatch,
	Question,
	Session,
	Step,
} from '../../shared/p0/types';
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	evidence,
	stubProvider,
} from './helpers';
import type { AnalysisProvider } from '../../server/analysis/provider';
import type { ExtractOutput } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import { discover } from '../../server/analysis/discover';
import test from 'node:test';

function providerFor(
	extraction: unknown,
	assessment: unknown,
	options: { onExtract?: (input: unknown) => void } = {},
): AnalysisProvider {
	return stubProvider({
		extract: (input) => {
			options.onExtract?.(input);
			return extraction;
		},
		assess: () => assessment,
	});
}

async function runDiscovery(
	session: Session,
	extraction: unknown,
	assessment: unknown = baseAssessment(),
	options: { onExtract?: (input: unknown) => void } = {},
): Promise<{ patch: DiscoveryPatch; artifactKey: string }> {
	return discover(session, providerFor(extraction, assessment, options));
}

function stepOf(patch: DiscoveryPatch, id: string): Step {
	const step = patch.workflow.steps.find((entry) => entry.id === id);
	assert.ok(step, `step ${id} expected in patch`);
	return step;
}

function questionOf(patch: DiscoveryPatch, id: string): Question {
	const question = patch.questions.find((entry) => entry.id === id);
	assert.ok(question, `question ${id} expected in patch`);
	return question;
}

test('discovery builds steps, edges, questions, and ranked opportunities', async () => {
	const { patch } = await runDiscovery(baseSession(), baseExtraction());

	assert.equal(patch.discovery?.stale, false);
	assert.equal(patch.discovery?.mode, 'live');

	const stepA = stepOf(patch, 'step_a');
	assert.equal(stepA.label.value, 'Receive reservation email');
	assert.equal(stepA.label.state, 'inferred');
	assert.equal(stepA.label.author, 'analysis');
	assert.ok(stepA.label.evidence.length >= 1);
	assert.equal(stepA.graphEligible, true);
	assert.equal(stepA.role.value, 'Front desk clerk');
	assert.equal(stepA.inputs.value, null);
	assert.equal(stepA.inputs.state, 'unknown');

	const edge = patch.workflow.edges.find((entry) => entry.id === 'edge_ab');
	assert.ok(edge, 'accepted transition becomes an edge');
	assert.equal(edge.fromStepId, 'step_a');
	assert.equal(edge.toStepId, 'step_b');
	assert.equal(edge.kind, 'sequence');
	assert.equal(edge.condition.value, null);

	const question = questionOf(patch, 'q_a');
	assert.equal(question.status, 'open');
	assert.equal(question.targetStepId, 'step_a');
	assert.equal(question.factKey, 'frequency');
	assert.equal(question.answer, null);

	const opportunity = patch.opportunities.find(
		(entry) => entry.id === 'opp_x',
	);
	assert.ok(opportunity, 'opportunity persisted');
	assert.equal(opportunity.hoursSavedPerMonth, 10);
	assert.equal(opportunity.assumptions.monthlyOccurrences.value, 100);
	assert.equal(opportunity.assumptions.monthlyOccurrences.edited, false);
	assert.equal(opportunity.factors.impact.value, 'high');
	assert.equal(opportunity.factors.effort.value, 'low');
	assert.equal(patch.reviewNotices.length, 0);
});

test('answers are supplied to the extract stage as evidence sources', async () => {
	const answered = baseSession({
		questions: [
			{
				id: 'q_prior',
				targetStepId: null,
				factKey: 'tool',
				prompt: 'Which system do clerks use?',
				whyItMatters: 'Tools drive integration options.',
				priority: 'high',
				status: 'answered',
				answer: {
					id: 'ans_prior',
					sourceRev: 1,
					text: 'Clerks use the PMS.',
				},
			},
		],
	});
	let extractInput: { answers?: unknown[]; transcript?: unknown } | undefined;
	const extraction = baseExtraction({
		steps: [
			{
				key: 'step_c',
				label: 'Use the PMS daily',
				role: null,
				tool: null,
				execution: null,
				evidence: [evidence('ans_prior', 'Clerks use the PMS.')],
				anchors: ['Clerks use the PMS.'],
			},
		],
		transitions: [],
		unknowns: [],
		opportunities: [],
	});
	await runDiscovery(
		answered,
		extraction,
		baseAssessment({ acceptedTransitionKeys: [], rejected: [] }),
		{
			onExtract: (input) => {
				extractInput = input as typeof extractInput;
			},
		},
	);
	assert.ok(extractInput);
	assert.deepEqual(extractInput.answers, [
		{
			questionId: 'q_prior',
			factKey: 'tool',
			targetStepId: null,
			answerId: 'ans_prior',
			answerRev: 1,
			text: 'Clerks use the PMS.',
		},
	]);
});

test('an accepted transition with solid provenance only needs the phrase', async () => {
	// The assessment accepts; the server independently re-verifies the quote.
	const extraction = baseExtraction();
	const { patch } = await runDiscovery(
		baseSession(),
		extraction,
		baseAssessment({ acceptedTransitionKeys: ['edge_ab'], rejected: [] }),
	);
	assert.equal(patch.workflow.edges.length, 1);
	assert.deepEqual(patch.reviewNotices, []);
});

test('a quote naming both endpoints without a transition phrase never makes an edge', async () => {
	const extraction = baseExtraction({
		transitions: [
			{
				key: 'edge_co',
				fromKey: 'step_a',
				toKey: 'step_b',
				kind: 'sequence',
				condition: null,
				evidence: evidence(
					'seg_c',
					'Clerks use the PMS all day, and housekeeping keeps the schedule sheet in Excel',
				),
				fromAnchor: 'the PMS',
				toAnchor: 'schedule sheet in Excel',
			},
		],
	});
	// Even when the assessment wrongly accepts it, the server re-check fails.
	const { patch } = await runDiscovery(
		baseSession(),
		extraction,
		baseAssessment({ acceptedTransitionKeys: ['edge_co'], rejected: [] }),
	);
	assert.deepEqual(patch.workflow.edges, []);
	assert.equal(patch.reviewNotices.length, 1);
	assert.equal(patch.reviewNotices[0]?.code, 'ambiguous_match');
	assert.match(patch.reviewNotices[0]?.message ?? '', /omitted/);
});

test('server provenance overrides a wrongful provider acceptance', async () => {
	const extraction = baseExtraction({
		transitions: [
			{
				key: 'edge_ab',
				fromKey: 'step_a',
				toKey: 'step_b',
				kind: 'sequence',
				condition: null,
				evidence: evidence('seg_c', 'Clerks use the PMS all day'),
				fromAnchor: 'not-in-quote',
				toAnchor: 'also-not-in-quote',
			},
		],
	});
	const { patch } = await runDiscovery(
		baseSession(),
		extraction,
		baseAssessment({ acceptedTransitionKeys: ['edge_ab'] }),
	);
	assert.deepEqual(patch.workflow.edges, []);
});

test('a candidate the assessment never covered is omitted with lost_evidence', async () => {
	const { patch } = await runDiscovery(
		baseSession(),
		baseExtraction(),
		baseAssessment({ acceptedTransitionKeys: [] }),
	);
	assert.deepEqual(patch.workflow.edges, []);
	assert.equal(patch.reviewNotices[0]?.code, 'lost_evidence');
	assert.match(patch.reviewNotices[0]?.message ?? '', /not assessed/);
});

test('provider-raised assessment notices are merged into reviewNotices', async () => {
	const { patch } = await runDiscovery(
		baseSession(),
		baseExtraction(),
		baseAssessment({
			notices: [
				{
					code: 'ambiguous_match',
					targetId: null,
					message:
						'The provider asks a human to confirm the handoff.',
				},
			],
		}),
	);
	assert.ok(
		patch.reviewNotices.some((notice) =>
			notice.message.includes('confirm the handoff'),
		),
	);
});

test('storage-owned review notices survive re-analysis', async () => {
	const session = baseSession({
		reviewNotices: [
			{
				code: 'answer_conflict',
				targetId: 'q_prior',
				message: 'The new answer conflicts with the graph.',
			},
		],
	});
	const { patch } = await runDiscovery(session, baseExtraction());
	assert.ok(
		patch.reviewNotices.some(
			(notice) =>
				notice.code === 'answer_conflict'
				&& notice.message.includes('conflicts with the graph'),
		),
	);
});

test('decision edges carry evidenced conditions; missing ones are rejected', async () => {
	const decisionExtraction = baseExtraction({
		transitions: [
			{
				key: 'edge_ab',
				fromKey: 'step_a',
				toKey: 'step_b',
				kind: 'decision',
				condition: 'When the email is a modification',
				evidence: evidence(
					'seg_b',
					'After reading the email, the clerk types the booking into the PMS',
				),
				fromAnchor: 'reading the email',
				toAnchor: 'types the booking into the PMS',
			},
		],
	});
	const decided = await runDiscovery(
		baseSession(),
		decisionExtraction,
		baseAssessment(),
	);
	const edge = decided.patch.workflow.edges[0];
	assert.ok(edge && edge.kind === 'decision');
	assert.equal(edge.condition.value, 'When the email is a modification');
	assert.equal(edge.condition.state, 'inferred');

	const missingCondition = baseExtraction({
		transitions: [
			{
				key: 'edge_ab',
				fromKey: 'step_a',
				toKey: 'step_b',
				kind: 'exception',
				condition: null,
				evidence: evidence(
					'seg_b',
					'After reading the email, the clerk types the booking into the PMS',
				),
				fromAnchor: 'reading the email',
				toAnchor: 'types the booking into the PMS',
			},
		],
	});
	await assert.rejects(
		() => runDiscovery(baseSession(), missingCondition, baseAssessment()),
		(error: unknown) =>
			error instanceof Error
			&& /missing its evidenced condition/.test(error.message),
	);
});

test('malformed provider output is rejected as invalid_model_output', async () => {
	const cases: { name: string; extraction: unknown; assessment?: unknown }[] =
		[
			{
				name: 'schema violation (missing label)',
				extraction: {
					steps: [
						{
							key: 'step_a',
							role: null,
							tool: null,
							execution: null,
							evidence: [
								evidence(
									'seg_a',
									'receives the reservation email',
								),
							],
							anchors: ['receives'],
						},
					],
					transitions: [],
					unknowns: [],
					opportunities: [],
				},
			},
			{
				name: 'duplicate step keys',
				extraction: baseExtraction({
					steps: [
						...baseExtraction().steps,
						baseExtraction()
							.steps[0] as ExtractOutput['steps'][number],
					],
				}),
			},
			{
				name: 'transition references an unextracted step',
				extraction: baseExtraction({
					transitions: [
						{
							key: 'edge_xz',
							fromKey: 'step_a',
							toKey: 'step_missing',
							kind: 'sequence',
							condition: null,
							evidence: evidence(
								'seg_b',
								'After reading the email',
							),
							fromAnchor: 'reading',
							toAnchor: 'email',
						},
					],
				}),
				assessment: baseAssessment({
					acceptedTransitionKeys: ['edge_xz'],
				}),
			},
			{
				name: 'duplicate unknown keys',
				extraction: baseExtraction({
					unknowns: [
						...baseExtraction().unknowns,
						{
							key: 'q_a',
							stepKey: 'step_b',
							factKey: 'tool',
							prompt: 'Duplicate key question?',
							whyItMatters: 'Because.',
							priority: 'low',
						},
					],
				}),
			},
			{
				name: 'question key collides with an existing id',
				extraction: baseExtraction({
					unknowns: [
						{
							key: 'q_other',
							stepKey: 'step_b',
							factKey: 'tool',
							prompt: 'Colliding question?',
							whyItMatters: 'Because.',
							priority: 'low',
						},
					],
				}),
				assessment: baseAssessment(),
				// (collision happens against the seeded prior question below)
			},
			{
				name: 'duplicate opportunity keys',
				extraction: baseExtraction({
					opportunities: [
						...baseExtraction().opportunities,
						baseExtraction()
							.opportunities[0] as ExtractOutput['opportunities'][number],
					],
				}),
			},
			{
				name: 'duplicate factor entries',
				extraction: baseExtraction({
					opportunities: [
						{
							...baseExtraction().opportunities[0]!,
							factors: [
								...baseExtraction().opportunities[0]!.factors,
								baseExtraction().opportunities[0]!.factors[0]!,
							],
						},
					],
				}),
			},
			{
				name: 'duplicate assumption entries',
				extraction: baseExtraction({
					opportunities: [
						{
							...baseExtraction().opportunities[0]!,
							assumptions: [
								...baseExtraction().opportunities[0]!
									.assumptions,
								baseExtraction().opportunities[0]!
									.assumptions[0]!,
							],
						},
					],
				}),
			},
			{
				name: 'negative assumption value',
				extraction: baseExtraction({
					opportunities: [
						{
							...baseExtraction().opportunities[0]!,
							assumptions: [
								{
									which: 'monthlyOccurrences',
									value: -5,
									basis: 'Bad estimate.',
									evidence: evidence(
										'seg_a',
										'receives the reservation email',
									),
								},
							],
						},
					],
				}),
			},
			{
				name: 'evidence quote is not verbatim',
				extraction: baseExtraction({
					steps: [
						{
							...baseExtraction().steps[0]!,
							evidence: [
								evidence(
									'seg_a',
									'this sentence was never said',
								),
							],
						},
						...baseExtraction().steps.slice(1),
					],
				}),
			},
			{
				name: 'evidence cites an outdated revision',
				extraction: baseExtraction({
					steps: [
						{
							...baseExtraction().steps[0]!,
							evidence: [
								{
									sourceId: 'seg_a',
									sourceRev: 2,
									quote: 'details',
								},
							],
						},
						...baseExtraction().steps.slice(1),
					],
				}),
			},
			{
				name: 'non-prefixed step key',
				extraction: baseExtraction({
					steps: [
						{
							...baseExtraction().steps[0]!,
							key: 'fancy_step',
						},
						...baseExtraction().steps.slice(1),
					],
				}),
			},
		];

	for (const testCase of cases) {
		if (testCase.name === 'question key collides with an existing id') {
			continue; // handled in its own test below
		}
		await assert.rejects(
			() =>
				runDiscovery(
					baseSession(),
					testCase.extraction,
					testCase.assessment ?? baseAssessment(),
				),
			(error: unknown) =>
				error instanceof Error
				&& /invalid model|schema|collides|Duplicate|same step|outside the extraction|twice|finite|verbatim|outdated|id prefix/.test(
					error.message,
				),
			`expected rejection: ${testCase.name}`,
		);
	}
});

test('a question key colliding with an existing id is rejected', async () => {
	const session = baseSession({
		questions: [
			{
				id: 'q_other',
				targetStepId: null,
				factKey: 'minutes',
				prompt: 'Existing question.',
				whyItMatters: 'Existing.',
				priority: 'low',
				status: 'open',
				answer: null,
			},
		],
	});
	await assert.rejects(
		() =>
			runDiscovery(
				session,
				baseExtraction({
					unknowns: [
						{
							key: 'q_other',
							stepKey: 'step_b',
							factKey: 'tool',
							prompt: 'Colliding question?',
							whyItMatters: 'Because.',
							priority: 'low',
						},
					],
				}),
			),
		(error: unknown) =>
			error instanceof Error
			&& /collides with an existing question id/.test(error.message),
	);
});

test('the assessment cannot invent transition keys', async () => {
	await assert.rejects(
		() =>
			runDiscovery(
				baseSession(),
				baseExtraction(),
				baseAssessment({ acceptedTransitionKeys: ['edge_ghost'] }),
			),
		(error: unknown) =>
			error instanceof Error
			&& /accepted unknown transition 'edge_ghost'/.test(error.message),
	);
});

test('two candidates resolving the same persisted step are rejected', async () => {
	const first = await runDiscovery(baseSession(), baseExtraction());
	const graphSession = { ...baseSession(), ...first.patch, rev: 2 };
	await assert.rejects(
		() =>
			runDiscovery(
				graphSession,
				baseExtraction({
					steps: [
						...baseExtraction().steps,
						{
							key: 'step_again',
							label: 'Second view of the same step',
							role: null,
							tool: null,
							execution: null,
							evidence: [
								evidence(
									'seg_a',
									'receives the reservation email',
								),
							],
							anchors: ['receives the reservation email'],
						},
					],
				}),
			),
		(error: unknown) =>
			error instanceof Error
			&& /resolve to the same step 'step_a'/.test(error.message),
	);
});
