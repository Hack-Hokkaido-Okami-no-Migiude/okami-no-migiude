// Fixture QA for the hotel demo (runs with tsx, no server build needed):
// seed -> base discovery -> documented follow-up answer -> grounded
// re-analysis -> housekeeping opportunity + proposal, plus every
// fixture-unsupported rejection. The fixture must never invent output for
// states it does not document, and answer-backed citations must carry the
// real persisted answer id.
import {
	HOTEL_DEMO_FOLLOWUP_ANSWER,
	HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	HOTEL_FIXTURE_VARIANT,
	HOTEL_FOLLOWUP_VARIANT,
	createHotelFixtureProvider,
	hotelSeed,
} from '../../server/demo/hotel';
import type { Id, Session } from '../../shared/p0/types';
import { discover, propose } from '../../server/analysis';
import {
	projectExtractInput,
	projectProposeInput,
} from '../../server/analysis/project';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import test from 'node:test';

const ANY_ANSWER_ID = 'ans_fu_01' as Id;

/** A fresh deep copy of the seed session (the store clones on write too). */
function freshSeedSession(): Session {
	return structuredClone(hotelSeed.session);
}

/** Record the documented follow-up answer the way the answer flow would. */
function recordFollowupAnswer(
	session: Session,
	answerId: Id,
	answerText: string = HOTEL_DEMO_FOLLOWUP_ANSWER,
): void {
	const question = session.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	if (!question) {
		throw new Error('q_hotel_01 must exist after base discovery');
	}
	question.status = 'answered';
	question.answer = { id: answerId, sourceRev: 1, text: answerText };
}

/** Base discovery applied to a fresh seed session. */
async function baseDiscovery(): Promise<Session> {
	const session = freshSeedSession();
	const { patch } = await discover(
		session,
		createHotelFixtureProvider(session),
	);
	return { ...session, ...patch };
}

/** Base discovery, then the documented answer, then follow-up discovery. */
async function followupDiscovery(): Promise<Session> {
	const discovered = await baseDiscovery();
	recordFollowupAnswer(discovered, ANY_ANSWER_ID);
	const { patch } = await discover(
		discovered,
		createHotelFixtureProvider(discovered),
	);
	return { ...discovered, ...patch };
}

test('base variant: discovery and proposal for the seeded demo session', async () => {
	const session = freshSeedSession();
	const provider = createHotelFixtureProvider(session);
	assert.equal(provider.mode, 'fixture');
	assert.equal(provider.key, HOTEL_FIXTURE_VARIANT);

	const { patch, artifactKey } = await discover(session, provider);
	assert.ok(artifactKey.length > 0);
	assert.deepEqual(patch.workflow.steps.map((step) => step.id).sort(), [
		'step_hotel_01',
		'step_hotel_02',
		'step_hotel_03',
		'step_hotel_04',
		'step_hotel_05',
		'step_hotel_06',
		'step_hotel_07',
	]);
	assert.deepEqual(patch.workflow.edges.map((edge) => edge.id).sort(), [
		'edge_hotel_01',
		'edge_hotel_02',
		'edge_hotel_03',
		'edge_hotel_04',
		'edge_hotel_05',
		'edge_hotel_06',
	]);
	// No edge on endpoint co-occurrence alone: the ambiguous candidate is
	// omitted from the graph and surfaces as a review notice.
	assert.equal(
		patch.workflow.edges.some(
			(edge) =>
				edge.fromStepId === 'step_hotel_02'
				&& edge.toStepId === 'step_hotel_06',
		),
		false,
	);
	assert.ok(
		patch.reviewNotices.some(
			(notice) =>
				notice.code === 'ambiguous_match'
				&& notice.message.includes(
					'Enter reservation into YukiReserve',
				),
		),
	);
	assert.deepEqual(
		patch.questions.map((question) => question.id),
		[HOTEL_DEMO_FOLLOWUP_QUESTION_ID],
	);
	const question = patch.questions[0];
	assert.equal(question?.status, 'open');
	assert.equal(question?.factKey, 'frequency');
	assert.equal(question?.targetStepId, 'step_hotel_07');
	assert.deepEqual(
		patch.opportunities.map((opportunity) => opportunity.id),
		['opp_hotel_01'],
	);
	const opportunity = patch.opportunities[0];
	assert.equal(opportunity?.strategy, 'integration');
	assert.equal(opportunity?.hoursSavedPerMonth, 80);

	const discovered: Session = { ...session, ...patch };
	const { proposal } = await propose(discovered, 'opp_hotel_01', provider);
	assert.equal(proposal.plan.id, 'plan_hotel_01');
	assert.deepEqual(proposal.graph.steps.map((step) => step.id).sort(), [
		'pstep_hotel_01',
		'pstep_hotel_02',
	]);
	assert.equal(proposal.stale, false);
});

test('follow-up variant: documented answer grounds the housekeeping discovery', async () => {
	const session = freshSeedSession();
	const baseProvider = createHotelFixtureProvider(session);
	const basePatch = (await discover(session, baseProvider)).patch;
	const discovered: Session = { ...session, ...basePatch };

	recordFollowupAnswer(discovered, ANY_ANSWER_ID);

	const followupProvider = createHotelFixtureProvider(discovered);
	assert.equal(followupProvider.key, HOTEL_FOLLOWUP_VARIANT);
	const { patch } = await discover(discovered, followupProvider);

	// The graph keeps every base element and adds the answer-backed step and
	// exception edge.
	assert.deepEqual(patch.workflow.steps.map((step) => step.id).sort(), [
		'step_hotel_01',
		'step_hotel_02',
		'step_hotel_03',
		'step_hotel_04',
		'step_hotel_05',
		'step_hotel_06',
		'step_hotel_07',
		'step_hotel_08',
	]);
	assert.deepEqual(patch.workflow.edges.map((edge) => edge.id).sort(), [
		'edge_hotel_01',
		'edge_hotel_02',
		'edge_hotel_03',
		'edge_hotel_04',
		'edge_hotel_05',
		'edge_hotel_06',
		'edge_hotel_07',
	]);
	const phoneEdge = patch.workflow.edges.find(
		(edge) => edge.id === 'edge_hotel_07',
	);
	assert.equal(phoneEdge?.kind, 'exception');
	assert.notEqual(phoneEdge?.condition.value, null);
	// The exception edge cites the persisted answer, not a segment.
	assert.ok(
		phoneEdge?.evidence.every((ref) => ref.sourceId === ANY_ANSWER_ID),
		'edge_hotel_07 must cite the persisted answer',
	);

	// The answered question and its real persisted answer survive re-analysis.
	const question = patch.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	assert.equal(question?.status, 'answered');
	assert.deepEqual(question?.answer, {
		id: ANY_ANSWER_ID,
		sourceRev: 1,
		text: HOTEL_DEMO_FOLLOWUP_ANSWER,
	});

	// The deterministic housekeeping opportunity appears next to the base one.
	assert.deepEqual(
		patch.opportunities.map((opportunity) => opportunity.id).sort(),
		['opp_hotel_01', 'opp_hotel_02'],
	);
	const housekeeping = patch.opportunities.find(
		(opportunity) => opportunity.id === 'opp_hotel_02',
	);
	assert.equal(housekeeping?.strategy, 'rules');
	const assumptions = housekeeping?.assumptions;
	assert.equal(assumptions?.monthlyOccurrences.value, 40);
	assert.equal(assumptions?.minutesSaved.value, 15);
	assert.equal(housekeeping?.hoursSavedPerMonth, 10);
	// The opportunity cites both the persisted answer and a transcript segment.
	assert.ok(
		housekeeping?.evidence.some((ref) => ref.sourceId === ANY_ANSWER_ID),
		'opp_hotel_02 must cite the persisted answer',
	);
	assert.ok(
		housekeeping?.evidence.some((ref) =>
			ref.sourceId.startsWith('seg_hotel_'),
		),
		'opp_hotel_02 must cite a transcript segment',
	);

	// The ambiguous co-occurrence rejection survives re-analysis.
	assert.ok(
		patch.reviewNotices.some((notice) => notice.code === 'ambiguous_match'),
	);

	const followupSession: Session = { ...discovered, ...patch };

	// The housekeeping proposal cites the answer through its persisted id.
	const { proposal: housekeepingProposal } = await propose(
		followupSession,
		'opp_hotel_02',
		followupProvider,
	);
	assert.equal(housekeepingProposal.plan.id, 'plan_hotel_02');
	assert.deepEqual(
		housekeepingProposal.graph.steps.map((step) => step.id).sort(),
		['pstep_hotel_03', 'pstep_hotel_04'],
	);
	assert.equal(
		housekeepingProposal.graph.edges.map((edge) => edge.id).length,
		1,
	);
	for (const step of housekeepingProposal.graph.steps) {
		assert.ok(
			step.evidence.some((ref) => ref.sourceId === ANY_ANSWER_ID),
			`proposed step ${step.id} must cite the persisted answer`,
		);
	}

	// The base opportunity is still propose-able in the follow-up session.
	const { proposal: baseProposal } = await propose(
		followupSession,
		'opp_hotel_01',
		followupProvider,
	);
	assert.equal(baseProposal.plan.id, 'plan_hotel_01');
});

test('fixture-unsupported states are rejected with fixture_unsupported', async () => {
	const expectStageError = async (
		run: () => Promise<unknown>,
		messagePart: RegExp,
	) => {
		await assert.rejects(
			run,
			(error: unknown) =>
				error instanceof StageError
				&& error.code === 'fixture_unsupported'
				&& messagePart.test(error.message),
			`expected fixture_unsupported matching ${String(messagePart)}`,
		);
	};

	// Two answered questions: the fixture covers only one documented answer.
	{
		const twoAnswers = freshSeedSession();
		const baseProvider = createHotelFixtureProvider(twoAnswers);
		const basePatch = (await discover(twoAnswers, baseProvider)).patch;
		const discovered: Session = { ...twoAnswers, ...basePatch };
		recordFollowupAnswer(discovered, 'ans_a' as Id);
		discovered.questions.push({
			id: 'q_hotel_02' as Id,
			targetStepId: 'step_hotel_03' as Id,
			factKey: 'frequency',
			prompt: 'seeded second question',
			whyItMatters: 'seeded second question',
			priority: 'medium',
			status: 'answered',
			answer: {
				id: 'ans_b' as Id,
				sourceRev: 1,
				text: 'Another answer.',
			},
		});
		await expectStageError(async () => {
			// The binding is resolved when the provider is built, so the
			// factory call itself must be inside the rejection assertion.
			const provider = createHotelFixtureProvider(discovered);
			return provider.run('extract', { variant: HOTEL_FOLLOWUP_VARIANT });
		}, /single documented follow-up answer/);
	}

	// Edited transcript: the fingerprint no longer matches the fixture.
	const altered = freshSeedSession();
	if (!altered.transcript) {
		throw new Error('seed session must carry its transcript');
	}
	const alteredSegment = altered.transcript.segments[3];
	if (!alteredSegment) {
		throw new Error('seed transcript must contain seg_hotel_04');
	}
	altered.transcript.segments[3] = {
		...alteredSegment,
		text: `${alteredSegment.text} Also emailed nightly.`,
	};
	{
		await expectStageError(async () => {
			const provider = createHotelFixtureProvider(altered);
			// The real projection carries the (edited) transcript, which must
			// fail the fingerprint check before any output is produced.
			return provider.run(
				'extract',
				projectExtractInput(altered, provider),
			);
		}, /no longer matches/);
	}

	// Different answer wording is a different source: unsupported.
	const wrongText = freshSeedSession();
	{
		const baseProvider = createHotelFixtureProvider(wrongText);
		const basePatch = (await discover(wrongText, baseProvider)).patch;
		const discovered: Session = { ...wrongText, ...basePatch };
		recordFollowupAnswer(
			discovered,
			'ans_wrong' as Id,
			'About ten room changes a week; each rewrite takes half an hour.',
		);
		await expectStageError(async () => {
			const provider = createHotelFixtureProvider(discovered);
			return provider.run('extract', { variant: HOTEL_FOLLOWUP_VARIANT });
		}, /does not match the documented follow-up answer/);
	}

	// Wrong projected variant or session identity in an otherwise valid
	// projection: the guards must reject before any output is produced.
	const baseSession = freshSeedSession();
	{
		const provider = createHotelFixtureProvider(baseSession);
		const projected = projectExtractInput(baseSession, provider);
		await expectStageError(
			() =>
				provider.run('extract', {
					...projected,
					variant: HOTEL_FOLLOWUP_VARIANT,
				}),
			/answers only for variant/,
		);
		await expectStageError(
			() =>
				provider.run('extract', {
					...projected,
					clientId: 'cli_other' as Id,
				}),
			/seeded demo session/,
		);
		await expectStageError(
			() => provider.run('rewrite' as 'extract', {}),
			/Unknown fixture stage/,
		);
	}

	// The base variant does not propose for the follow-up opportunity: the
	// real follow-up opportunity shape is offered to a base-binding provider.
	{
		const followupSession = await followupDiscovery();
		const housekeeping = followupSession.opportunities.find(
			(opportunity) => opportunity.id === 'opp_hotel_02',
		);
		if (!housekeeping) {
			throw new Error(
				'opp_hotel_02 must exist after follow-up discovery',
			);
		}
		const baseProvider = createHotelFixtureProvider(freshSeedSession());
		await expectStageError(async () => {
			const projected = projectProposeInput(
				followupSession,
				'opp_hotel_02' as Id,
				baseProvider,
			);
			return baseProvider.run('propose', projected);
		}, /does not propose for opportunity/);
	}
});

test('fixture outputs are deterministic for identical persisted state', async () => {
	const sessionA = freshSeedSession();
	const patchA = (
		await discover(sessionA, createHotelFixtureProvider(sessionA))
	).patch;

	const sessionB = freshSeedSession();
	const patchB = (
		await discover(sessionB, createHotelFixtureProvider(sessionB))
	).patch;

	// completedAt is the only wall-clock field; everything else must match.
	const stripTimestamps = (value: unknown): unknown => {
		if (value === null || typeof value !== 'object') {
			return value;
		}
		if (Array.isArray(value)) {
			return value.map(stripTimestamps);
		}
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([key]) => key !== 'completedAt')
				.map(([key, entry]) => [key, stripTimestamps(entry)]),
		);
	};
	assert.deepEqual(stripTimestamps(patchA), stripTimestamps(patchB));

	// The projected provider outputs are identical across provider instances.
	const providerA = createHotelFixtureProvider(freshSeedSession());
	const providerB = createHotelFixtureProvider(freshSeedSession());
	const extractInput = projectExtractInput(freshSeedSession(), providerA);
	assert.deepEqual(
		await providerA.run('extract', extractInput),
		await providerB.run('extract', extractInput),
	);
});
