// API tests: the full fixture demo flow — seed, discovery, verified correction
// preserved through re-derivation, answered-question suppression, proposal
// generation, savings math, plan review/approval gating, and boundary/scope
// guards. Runs against the built Nitro server on a private port.
import { after, before, test } from 'node:test';
import {
	call,
	errorBody,
	startServer,
	stopServer,
} from './helpers/server';
import type { Session } from '../../../shared/p0/types';
import assert from 'node:assert/strict';

const base = { url: '' };
const demoPath = '/api/demo/hotel';
const sessionPath = '/api/clients/cli_hotel_demo/sessions/ses_hotel_demo';

/** The documented follow-up answer (same wording as the fixture module). */
const FOLLOWUP_ANSWER =
	'Roughly two or three modification emails a day in high season, and maybe '
	+ 'one a day outside it; each one takes a couple of minutes to fix in '
	+ 'YukiReserve. The bigger headache is room changes. Whenever we change a '
	+ 'booking in YukiReserve — a modification email or a guest at the desk '
	+ 'asking to move rooms — if the room change happens after the 7:30 '
	+ 'arrivals list has gone over, we phone the housekeeping desk and Abe '
	+ 'rewrites the affected rows in the Excel schedule sheet by hand. I would '
	+ 'say we phone through about ten room changes a week in high season, and '
	+ 'each call plus the rewrite takes about a quarter of an hour. If we '
	+ 'forget to call, housekeeping sometimes cleans the wrong room first.';

const asSession = (json: unknown): Session => json as Session;

before(async () => {
	base.url = await startServer();
});
after(async () => {
	await stopServer();
});

test('seeds the demo once and never resets it on repeat', async () => {
	const first = await call('POST', `${base.url}${demoPath}`, {});
	assert.equal(first.status, 200);
	const session = asSession(first.json);
	assert.equal(session.id, 'ses_hotel_demo');
	assert.equal(session.rev, 1);
	assert.equal(session.transcript?.segments.length, 9);
	assert.equal(session.workflow.steps.length, 0);
	assert.equal(session.discovery, null);

	const second = await call('POST', `${base.url}${demoPath}`, {});
	assert.equal(second.status, 200);
	assert.equal(asSession(second.json).rev, 1, 'repeat seeding is a no-op');
});

test('fixture discovery builds the graph, the open question, and the rejection notice', async () => {
	const response = await call('POST', `${base.url}${sessionPath}/analyze`, {
		baseRev: 1,
		mode: 'fixture',
	});
	assert.equal(response.status, 200);
	const body = response.json as { outcome: string; session: Session };
	assert.equal(body.outcome, 'updated');
	const session = body.session;
	assert.equal(session.rev, 2);
	assert.equal(session.workflow.steps.length, 7);
	assert.equal(session.workflow.edges.length, 6);
	assert.equal(
		session.workflow.edges.some((edge) => edge.id === 'edge_hotel_reject_cooccur'),
		false,
		'co-occurrence-only candidates must not become edges',
	);
	assert.equal(
		session.reviewNotices.some((notice) => notice.code === 'ambiguous_match'),
		true,
	);
	const question = session.questions.find((entry) => entry.id === 'q_hotel_01');
	assert.equal(question?.status, 'open');
	assert.equal(question?.answer, null);
	assert.equal(
		session.opportunities.some((entry) => entry.id === 'opp_hotel_01'),
		true,
	);
	assert.equal(session.discovery?.stale, false);
	assert.equal(session.discovery?.mode, 'fixture');
});

test('a verified correction and the documented answer are recorded', async () => {
	const corrected = await call(
		'PATCH',
		`${base.url}${sessionPath}/steps/step_hotel_02`,
		{
			baseRev: 2,
			fields: {
				label: {
					value: 'Enter reservation into YukiReserve after double-checking',
					evidence: [{
						sourceId: 'seg_hotel_02',
						sourceRev: 1,
						quote: 'types them into YukiReserve, our property management system',
					}],
				},
			},
			verify: true,
		},
	);
	assert.equal(corrected.status, 200);
	const session = asSession(corrected.json);
	assert.equal(session.rev, 3);
	const step2 = session.workflow.steps.find((entry) => entry.id === 'step_hotel_02');
	assert.equal(step2?.label.state, 'consultant-verified');
	assert.equal(step2?.label.author, 'consultant');

	const answered = await call(
		'PUT',
		`${base.url}${sessionPath}/questions/q_hotel_01/answer`,
		{ baseRev: 3, text: FOLLOWUP_ANSWER },
	);
	assert.equal(answered.status, 200);
	const afterAnswer = asSession(answered.json);
	assert.equal(afterAnswer.rev, 4);
	const question = afterAnswer.questions.find((entry) => entry.id === 'q_hotel_01');
	assert.equal(question?.status, 'answered');
	assert.match(question?.answer?.id ?? '', /^ans_/);
	assert.equal(question?.answer?.sourceRev, 1);
	assert.equal(afterAnswer.discovery?.stale, true, 'a saved answer stales discovery');
});

test('re-derivation preserves the verified edit and the answered question', async () => {
	const response = await call('POST', `${base.url}${sessionPath}/analyze`, {
		baseRev: 4,
		mode: 'fixture',
	});
	assert.equal(response.status, 200);
	const body = response.json as { outcome: string; session: Session };
	assert.equal(body.outcome, 'updated');
	const session = body.session;
	assert.equal(session.rev, 5);
	assert.equal(session.discovery?.stale, false);

	const step2 = session.workflow.steps.find((entry) => entry.id === 'step_hotel_02');
	assert.equal(
		step2?.label.state,
		'consultant-verified',
		'verified consultant edits survive re-derivation',
	);
	assert.equal(
		step2?.label.value,
		'Enter reservation into YukiReserve after double-checking',
	);

	const matches = session.questions.filter((entry) => entry.id === 'q_hotel_01');
	assert.equal(matches.length, 1, 'the answered question must not be re-asked');
	assert.equal(matches[0]?.status, 'answered');
	assert.equal(matches[0]?.answer?.text, FOLLOWUP_ANSWER);
});

test('proposal generation creates the plan; review edits and approval gate work', async () => {
	const proposed = await call(
		'POST',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: 5, mode: 'fixture' },
	);
	assert.equal(proposed.status, 200);
	const body = proposed.json as { outcome: string; session: Session };
	assert.equal(body.outcome, 'updated');
	const session = body.session;
	assert.equal(session.rev, 6);
	const proposal = session.proposals.find(
		(entry) => entry.opportunityId === 'opp_hotel_01',
	);
	assert.ok(proposal, 'the demo opportunity now has a proposal');
	assert.equal(proposal.stale, false);
	assert.equal(proposal.plan.status, 'draft');
	assert.equal(proposal.plan.sections.scope.length > 0, true);
	assert.equal(proposal.graph.steps.length, 2);

	const markdown = await call(
		'GET',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/plan.md`,
	);
	assert.equal(markdown.status, 200);
	assert.match(markdown.text, /YukiReserve/);

	// Savings math is exact: occurrences × minutes ÷ 60. 40 × 4 / 60 repeats
	// forever, and the wire schema accepts any finite nonnegative value.
	const overPrecise = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01`,
		{
			baseRev: 6,
			assumptions: {
				monthlyOccurrences: { value: 40, basis: 'Stated in the interview.', evidence: [] },
			},
		},
	);
	assert.equal(overPrecise.status, 200);
	const overPreciseSession = asSession(overPrecise.json);
	assert.equal(overPreciseSession.rev, 7);
	assert.ok(
		Math.abs(
			(overPreciseSession.opportunities.find((entry) => entry.id === 'opp_hotel_01')
				?.hoursSavedPerMonth ?? 0)
			- (40 * 4) / 60,
		) < 1e-9,
	);

	// 40 x 6 / 60 = 4 exactly.
	const minutesEdit = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01`,
		{
			baseRev: 7,
			assumptions: {
				minutesSaved: { value: 6, basis: 'Re-timed with the clerk.', evidence: [] },
			},
		},
	);
	assert.equal(minutesEdit.status, 200);
	const withSavings = asSession(minutesEdit.json);
	assert.equal(withSavings.rev, 8);
	const edited = withSavings.opportunities.find(
		(entry) => entry.id === 'opp_hotel_01',
	);
	assert.equal(edited?.hoursSavedPerMonth, 4);
	assert.equal(edited?.assumptions.minutesSaved.edited, true);
	assert.equal(withSavings.discovery?.stale, false, 'assumption edits keep discovery fresh');
	assert.equal(
		withSavings.proposals.find((entry) => entry.opportunityId === 'opp_hotel_01')?.stale,
		true,
		'assumption edits stale their own proposal',
	);

	// Zero stays zero.
	const zeroEdit = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01`,
		{
			baseRev: 8,
			assumptions: {
				minutesSaved: { value: 0, basis: 'Re-timed with the clerk.', evidence: [] },
			},
		},
	);
	assert.equal(zeroEdit.status, 200);
	assert.equal(
		asSession(zeroEdit.json).opportunities.find((entry) => entry.id === 'opp_hotel_01')
			?.hoursSavedPerMonth,
		0,
	);

	// A cleared occurrence clears the savings estimate.
	const clearedEdit = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01`,
		{
			baseRev: 9,
			assumptions: {
				monthlyOccurrences: { value: null, basis: 'Not yet established.', evidence: [] },
			},
		},
	);
	assert.equal(clearedEdit.status, 200);
	assert.equal(
		asSession(clearedEdit.json).opportunities.find((entry) => entry.id === 'opp_hotel_01')
			?.hoursSavedPerMonth,
		null,
	);

	// Approval is blocked while the proposal is stale.
	const blocked = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/plan`,
		{ baseRev: 10, status: 'approved' },
	);
	assert.equal(blocked.status, 409);
	assert.equal(errorBody(blocked.json).code, 'stale_artifact');

	// Regeneration clears the staleness and resets the plan to draft.
	const regenerated = await call(
		'POST',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: 10, mode: 'fixture' },
	);
	assert.equal(regenerated.status, 200);
	const fresh = asSession((regenerated.json as { session: Session }).session);
	assert.equal(fresh.rev, 11);
	const freshProposal = fresh.proposals.find(
		(entry) => entry.opportunityId === 'opp_hotel_01',
	);
	assert.equal(freshProposal?.stale, false);
	assert.equal(freshProposal?.plan.status, 'draft');

	const approved = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/plan`,
		{ baseRev: 11, status: 'approved' },
	);
	assert.equal(approved.status, 200);
	assert.equal(
		asSession(approved.json).proposals.find(
			(entry) => entry.opportunityId === 'opp_hotel_01',
		)?.plan.status,
		'approved',
	);

	// A section edit resets the status to draft; approval works again because
	// the plan itself is not part of the proposal basis.
	const sectionEdit = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/plan`,
		{
			baseRev: 12,
			sections: {
				scope: 'Consultant-tailored scope: integrate the booking engine feed directly.',
			},
		},
	);
	assert.equal(sectionEdit.status, 200);
	const editedSession = asSession(sectionEdit.json);
	assert.equal(editedSession.rev, 13);
	const editedPlan = editedSession.proposals.find(
		(entry) => entry.opportunityId === 'opp_hotel_01',
	)?.plan;
	assert.equal(editedPlan?.status, 'draft');
	assert.equal(
		editedPlan?.sections.scope,
		'Consultant-tailored scope: integrate the booking engine feed directly.',
	);

	const reapproved = await call(
		'PATCH',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/plan`,
		{ baseRev: 13, status: 'approved' },
	);
	assert.equal(reapproved.status, 200);
	assert.equal(
		asSession(reapproved.json).proposals.find(
			(entry) => entry.opportunityId === 'opp_hotel_01',
		)?.plan.status,
		'approved',
	);
});

test('an unsupported transcript edit drops derived work and fixture runs refuse it', async () => {
	// PUT replaces the whole transcript, so resubmit every row and change one.
	const before = await call('GET', `${base.url}${sessionPath}`);
	assert.equal(before.status, 200);
	const previousSegments = asSession(before.json).transcript?.segments ?? [];
	const segments = previousSegments.map((segment) => ({
		id: segment.id,
		speaker: segment.speaker,
		text:
			segment.id === 'seg_hotel_02'
				? `${segment.text} The inbox is checked at nine.`
				: segment.text,
		startMs: segment.startMs,
		endMs: segment.endMs,
	}));
	const edited = await call('PUT', `${base.url}${sessionPath}/transcript`, {
		baseRev: 14,
		segments,
	});
	assert.equal(edited.status, 200);
	const session = asSession(edited.json);
	assert.equal(session.rev, 15);
	assert.equal(
		session.opportunities.some((entry) => entry.id === 'opp_hotel_01'),
		false,
		'the opportunity whose evidence became invalid is dropped',
	);
	assert.equal(
		session.opportunities.some((entry) => entry.id === 'opp_hotel_02'),
		true,
		'opportunities backed by untouched sources survive',
	);
	assert.equal(
		session.proposals.length,
		0,
		'the dropped opportunity loses its proposal and plan',
	);
	assert.equal(session.workflow.steps.length, 8, 'steps are never deleted');
	assert.equal(session.discovery?.stale, true);
	assert.equal(
		session.reviewNotices.some((notice) => notice.code === 'lost_evidence'),
		true,
	);

	const rerun = await call('POST', `${base.url}${sessionPath}/analyze`, {
		baseRev: 15,
		mode: 'fixture',
	});
	assert.equal(rerun.status, 422);
	assert.equal(errorBody(rerun.json).code, 'fixture_unsupported');

	const proposed = await call(
		'POST',
		`${base.url}${sessionPath}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: 15, mode: 'fixture' },
	);
	assert.equal(proposed.status, 404);
	assert.equal(
		errorBody(proposed.json).message,
		"Unknown opportunity for this session.",
	);
});

test('boundary and scope guards return the fixed error phrases', async () => {
	const noEvidence = await call(
		'PATCH',
		`${base.url}${sessionPath}/steps/step_hotel_01`,
		{ baseRev: 15, fields: { label: { value: 'No evidence', evidence: [] } }, verify: false },
	);
	assert.equal(noEvidence.status, 400);
	assert.equal(
		errorBody(noEvidence.json).message,
		'A submitted step field value requires at least one evidence reference.',
	);

	const cleared = await call(
		'PATCH',
		`${base.url}${sessionPath}/steps/step_hotel_01`,
		{
			baseRev: 15,
			fields: {
				label: {
					value: null,
					evidence: [{ sourceId: 'seg_hotel_01', sourceRev: 1, quote: 'Reservations arrive in three ways' }],
				},
			},
			verify: false,
		},
	);
	assert.equal(cleared.status, 400);
	assert.equal(
		errorBody(cleared.json).message,
		'A cleared step field must not carry evidence references.',
	);

	const fabricated = await call(
		'PATCH',
		`${base.url}${sessionPath}/steps/step_hotel_01`,
		{
			baseRev: 15,
			fields: {
				label: {
					value: 'Supported by nothing',
					evidence: [{ sourceId: 'seg_hotel_01', sourceRev: 1, quote: 'This wording exists nowhere' }],
				},
			},
			verify: false,
		},
	);
	assert.equal(fabricated.status, 400);
	assert.equal(errorBody(fabricated.json).code, 'invalid_input');

	const unknownStep = await call(
		'PATCH',
		`${base.url}${sessionPath}/steps/step_nope`,
		{ baseRev: 15, fields: { label: { value: 'x', evidence: [{ sourceId: 'seg_hotel_01', sourceRev: 1, quote: 'Reservations arrive in three ways' }] } }, verify: true },
	);
	assert.equal(unknownStep.status, 404);
	assert.equal(
		errorBody(unknownStep.json).message,
		"Unknown step 'step_nope' for this session.",
	);

	const unknownQuestion = await call(
		'PUT',
		`${base.url}${sessionPath}/questions/q_nope/answer`,
		{ baseRev: 15, text: 'An answer for nobody.' },
	);
	assert.equal(unknownQuestion.status, 404);
	assert.equal(
		errorBody(unknownQuestion.json).message,
		"Unknown question 'q_nope' for this session.",
	);

	const staleRev = await call('PUT', `${base.url}${sessionPath}/transcript`, {
		baseRev: 1,
		segments: [{ text: 'Too old.' }],
	});
	assert.equal(staleRev.status, 409);
	const staleBody = errorBody(staleRev.json);
	assert.equal(staleBody.code, 'stale_revision');
	assert.equal(staleBody.currentRev, 15);

	const badQuery = await call(
		'DELETE',
		`${base.url}${sessionPath}/transcript?baseRev=abc`,
	);
	assert.equal(badQuery.status, 400);
	assert.equal(
		errorBody(badQuery.json).message,
		'Query parameter baseRev must be a positive integer.',
	);

	const oversized = await call('PUT', `${base.url}${sessionPath}/transcript`, {
		baseRev: 15,
		segments: [{ text: 'x'.repeat(5_100_000) }],
	});
	assert.equal(oversized.status, 400);
	assert.equal(
		errorBody(oversized.json).message,
		'Request body is too large.',
	);
});
