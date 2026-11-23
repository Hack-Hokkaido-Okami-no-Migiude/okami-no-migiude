// Re-analysis regression: run discovery, let a consultant verify a finding and
// answer a question, then re-run discovery with a fresh extraction. Ids stay
// stable, consultant edits and manual assumptions survive, the answered
// question is suppressed even when the provider paraphrases it, and the
// discovery key reflects the overrides so the run is not mistaken for a no-op.
import type { Session, Step } from '../../shared/p0/types';
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	evidenceRef,
	stubProvider,
	verifiedClaim,
} from './helpers';
import type { AnalysisProvider } from '../../server/analysis/provider';
import assert from 'node:assert/strict';
import { computeInvalidation } from '../../server/analysis/invalidate';
import { discover } from '../../server/analysis/discover';
import { runKey } from '../../server/analysis/keys';
import test from 'node:test';

function providerFor(
	extraction: unknown,
	assessment: unknown,
): AnalysisProvider {
	return stubProvider({
		extract: () => extraction,
		assess: () => assessment,
	});
}

test('re-analysis preserves consultant work, suppresses answered questions, and keeps ids stable', async () => {
	// --- Run 1: discovery over the empty session.
	const session0 = baseSession();
	const first = await discover(
		session0,
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...session0, ...first.patch, rev: 2 };
	assert.equal(session1.workflow.steps.length, 2);
	assert.equal(session1.questions.length, 1);
	assert.equal(session1.opportunities.length, 1);

	// --- Consultant verifies one label and answers the open question.
	const verifiedLabel = verifiedClaim(
		'Receive reservation email (verified)',
		[evidenceRef('seg_a', 'receives the reservation email')],
	);
	const withEdits: Session = {
		...session1,
		workflow: {
			...session1.workflow,
			steps: session1.workflow.steps.map((step): Step =>
				step.id === 'step_a' ? { ...step, label: verifiedLabel } : step,
			),
		},
		questions: session1.questions.map((question) =>
			question.id === 'q_a' ?
				{
					...question,
					status: 'answered',
					answer: {
						id: 'ans_hotel_01',
						sourceRev: 1,
						text: 'About 30 reservation emails arrive per day.',
					},
				}
			:	question,
		),
	};

	// --- The edits must change the discovery key (no false "unchanged").
	assert.notEqual(
		runKey(
			withEdits,
			'discover',
			providerFor(baseExtraction(), baseAssessment()),
		),
		runKey(
			session1,
			'discover',
			providerFor(baseExtraction(), baseAssessment()),
		),
	);
	const invalidation = computeInvalidation(session1, withEdits);
	assert.equal(invalidation.discoveryStale, true);

	// --- Run 2: same shape of extraction, paraphrased question, new question.
	const paraphrased = baseExtraction({
		unknowns: [
			{
				key: 'q_a',
				stepKey: 'step_a',
				factKey: 'frequency',
				prompt: 'What is the daily volume of reservation emails?',
				whyItMatters: 'Still drives the automation case.',
				priority: 'high',
			},
			{
				key: 'q_b',
				stepKey: 'step_b',
				factKey: 'tool',
				prompt: 'Which PMS module holds the bookings?',
				whyItMatters: 'Integration needs the module name.',
				priority: 'medium',
			},
		],
	});
	const second = await discover(
		withEdits,
		providerFor(paraphrased, baseAssessment()),
	);
	const session2: Session = { ...withEdits, ...second.patch, rev: 3 };

	// --- Ids stay stable.
	assert.deepEqual(
		session2.workflow.steps.map((step) => step.id),
		['step_a', 'step_b'],
	);
	assert.deepEqual(
		session2.workflow.edges.map((edge) => edge.id),
		['edge_ab'],
	);
	assert.deepEqual(
		session2.opportunities.map((opportunity) => opportunity.id),
		['opp_x'],
	);

	// --- The consultant-verified label survives; analysis claims re-derive.
	const stepA = session2.workflow.steps.find((step) => step.id === 'step_a');
	assert.ok(stepA);
	assert.equal(stepA.label.state, 'consultant-verified');
	assert.equal(stepA.label.value, 'Receive reservation email (verified)');
	const stepB = session2.workflow.steps.find((step) => step.id === 'step_b');
	assert.ok(stepB);
	assert.equal(stepB.label.state, 'inferred');
	assert.equal(stepB.label.author, 'analysis');

	// --- The answered question is suppressed even though the prompt changed.
	assert.equal(session2.questions.length, 2);
	const answered = session2.questions.find(
		(question) => question.id === 'q_a',
	);
	assert.ok(answered);
	assert.equal(answered.status, 'answered');
	assert.equal(
		answered.answer?.text,
		'About 30 reservation emails arrive per day.',
	);
	assert.deepEqual(
		session2.questions
			.filter((question) => question.id === 'q_b')
			.map((question) => question.status),
		['open'],
	);

	// --- The opportunity (including any manual assumption edits) is not duplicated.
	assert.equal(
		session2.opportunities[0]?.assumptions.monthlyOccurrences.value,
		100,
	);

	// --- After the committed re-analysis the same key returns an unchanged run.
	assert.equal(
		runKey(
			session2,
			'discover',
			providerFor(paraphrased, baseAssessment()),
		),
		runKey(
			withEdits,
			'discover',
			providerFor(paraphrased, baseAssessment()),
		),
	);
});

test('unmatched analysis-only steps are dropped; consultant-supported ones stay review-only', async () => {
	const first = await discover(
		baseSession(),
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...baseSession(), ...first.patch, rev: 2 };

	// The consultant verifies a third step the next extraction will not produce.
	const consultantStep: Step = {
		id: 'step_manual',
		label: verifiedClaim('Manually tracked in a notebook', [
			evidenceRef('seg_c', 'housekeeping keeps the schedule sheet'),
		]),
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
	};

	const withExtra: Session = {
		...session1,
		workflow: {
			steps: [...session1.workflow.steps, consultantStep],
			edges: session1.workflow.edges,
		},
	};
	const second = await discover(
		withExtra,
		providerFor(baseExtraction(), baseAssessment()),
	);
	const surviving = second.patch.workflow.steps.find(
		(step) => step.id === 'step_manual',
	);
	assert.ok(surviving, 'consultant-supported step survives');
	assert.equal(
		surviving.graphEligible,
		false,
		'survivor becomes review-only',
	);
	assert.ok(
		second.patch.reviewNotices.some(
			(notice) =>
				notice.code === 'lost_evidence'
				&& notice.targetId === 'step_manual',
		),
	);
});

test('questions and opportunities referencing vanished steps are retired or pruned', async () => {
	const first = await discover(
		baseSession(),
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...baseSession(), ...first.patch, rev: 2 };

	// Second extraction only re-finds step_b; step_a disappears from the graph.
	const partial = baseExtraction({
		steps: [baseExtraction().steps[1] as ExtractOutputStep],
		transitions: [],
		unknowns: [
			{
				key: 'q_b',
				stepKey: 'step_b',
				factKey: 'tool',
				prompt: 'Which module?',
				whyItMatters: 'Integration.',
				priority: 'low',
			},
		],
		opportunities: [],
	});
	const second = await discover(
		session1,
		providerFor(partial, baseAssessment({ acceptedTransitionKeys: [] })),
	);

	assert.deepEqual(
		second.patch.workflow.steps.map((step) => step.id),
		['step_b'],
	);
	assert.deepEqual(second.patch.workflow.edges, []);

	const retired = second.patch.questions.find(
		(question) => question.id === 'q_a',
	);
	assert.ok(retired);
	assert.equal(retired.status, 'retired');
	assert.equal(retired.targetStepId, null);

	const pruned = second.patch.opportunities.find(
		(opportunity) => opportunity.id === 'opp_x',
	);
	assert.ok(pruned, 'opportunity survives with its remaining step');
	assert.deepEqual(pruned.stepIds, ['step_b']);
	assert.ok(
		second.patch.reviewNotices.some(
			(notice) =>
				notice.code === 'lost_evidence' && notice.targetId === 'opp_x',
		),
	);
});

test('an opportunity whose steps all vanish is dropped with its proposal', async () => {
	const first = await discover(
		baseSession(),
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...baseSession(), ...first.patch, rev: 2 };
	const withProposal: Session = {
		...session1,
		proposals: [
			{
				opportunityId: 'opp_x',
				graph: {
					steps: [
						{
							id: 'pstep_1',
							label: 'Automate entry',
							currentStepIds: ['step_a', 'step_b'],
							evidence: [
								evidenceRef(
									'seg_b',
									'types the booking into the PMS',
								),
							],
						},
					],
					edges: [],
				},
				plan: {
					id: 'plan_x',
					status: 'draft',
					sections: {
						scope: 'Automate entry.',
						businessRules: 'Structured emails only.',
						integrationsAuth: 'Service account.',
						exceptions: 'Free text stays manual.',
						humanOversight: 'Clerk review.',
						milestones: 'Pilot first.',
						acceptanceTests: 'Sample match.',
					},
					editedSections: [],
				},
				mode: 'live',
				stale: false,
			},
		],
	};

	const empty = baseExtraction({
		steps: [],
		transitions: [],
		unknowns: [],
		opportunities: [],
	});
	const second = await discover(
		withProposal,
		providerFor(empty, baseAssessment({ acceptedTransitionKeys: [] })),
	);
	assert.deepEqual(second.patch.opportunities, []);
	assert.ok(
		second.patch.reviewNotices.some(
			(notice) =>
				notice.code === 'lost_evidence'
				&& notice.targetId === 'opp_x'
				&& /removed together with its proposal/.test(notice.message),
		),
	);
});

type ExtractOutputStep = ReturnType<typeof baseExtraction>['steps'][number];

/** A consultant step whose label citation was purged by the cascade. */
function withPurgedConsultantLabel(session: Session): Session {
	return {
		...session,
		workflow: {
			...session.workflow,
			steps: session.workflow.steps.map((step: Step) =>
				step.id === 'step_a' ?
					{
						...step,
						label: {
							value: null,
							state: 'unknown' as const,
							author: 'consultant' as const,
							evidence: [],
						},
					}
				:	step,
			),
		},
	};
}

test('a purged consultant label is not resurrected by re-analysis', async () => {
	const first = await discover(
		baseSession(),
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...baseSession(), ...first.patch, rev: 2 };
	const purged = withPurgedConsultantLabel(session1);

	// A fresh extraction that re-derives the step by the same id must not
	// re-enable the review-only step or resurrect the purged value.
	const second = await discover(
		purged,
		providerFor(baseExtraction(), baseAssessment()),
	);
	const stepA = second.patch.workflow.steps.find(
		(step) => step.id === 'step_a',
	);
	assert.ok(stepA, 'the consultant step survives reconciliation');
	assert.equal(
		stepA.label.value,
		null,
		'the purged value is not resurrected as a claim',
	);
	assert.equal(stepA.label.author, 'consultant');
	assert.equal(
		stepA.graphEligible,
		false,
		'a step without a known label stays review-only',
	);
});

test('a purged consultant step unmatched by the fresh extraction stays review-only', async () => {
	const first = await discover(
		baseSession(),
		providerFor(baseExtraction(), baseAssessment()),
	);
	const session1: Session = { ...baseSession(), ...first.patch, rev: 2 };
	const purged = withPurgedConsultantLabel(session1);

	// The fresh extraction no longer reaches the step; the preserved
	// consultant row stays review-only instead of being re-enabled.
	const stepBOnly: ExtractOutputStep = {
		key: 'step_b',
		label: 'Enter booking into the PMS',
		role: 'Front desk clerk',
		tool: 'PMS',
		execution: 'manual',
		evidence: [evidenceRef('seg_b', 'types the booking into the PMS')],
		anchors: ['types the booking into the PMS'],
	};
	const reduced = baseExtraction({
		steps: [stepBOnly],
		transitions: [],
		unknowns: [],
		opportunities: [],
	});
	const second = await discover(
		purged,
		providerFor(reduced, baseAssessment({ acceptedTransitionKeys: [] })),
	);
	const stepA = second.patch.workflow.steps.find(
		(step) => step.id === 'step_a',
	);
	assert.ok(stepA);
	assert.equal(stepA.label.value, null);
	assert.equal(stepA.graphEligible, false);
	assert.ok(
		second.patch.reviewNotices.some(
			(entry) =>
				entry.code === 'lost_evidence' && entry.targetId === 'step_a',
		),
	);
});
