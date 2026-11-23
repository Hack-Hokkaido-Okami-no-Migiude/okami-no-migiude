// Store unit tests: staleness semantics around the analysis seam's
// computeInvalidation helper — source/answer changes stale discovery, step
// corrections stale discovery explicitly, assumption edits stale only their
// proposal, and identical content is detected as a no-op.
import {
	answerRecord,
	evidence,
	makeSession,
	proposal,
	question,
	run,
	segment,
	step,
	verifiedTextClaim,
} from './helpers/fixture';
import { applyInvalidation, sameSession } from '../../server/store/invalidation';
import assert from 'node:assert/strict';
import test from 'node:test';

function baseSession() {
	return makeSession({
		discovery: run('fixture'),
		proposals: [proposal('opp_1', 'plan_1')],
	});
}

test('transcript and answer changes stale discovery', () => {
	const previous = baseSession();
	const transcriptEdit = applyInvalidation(
		previous,
		makeSession({
			discovery: run('fixture'),
			proposals: [proposal('opp_1', 'plan_1')],
			segments: [
				segment('seg_src1', 'The clerk types every booking into the PMS by hand, slowly.', 2),
				segment('seg_src2', 'Then housekeeping retype the list into their sheet.'),
			],
		}),
	);
	assert.equal(transcriptEdit.discovery?.stale, true);

	const answerEdit = applyInvalidation(
		previous,
		makeSession({
			discovery: run('fixture'),
			proposals: [proposal('opp_1', 'plan_1')],
			questions: [
				question('q_1', 'step_1', 'tool', {
					status: 'answered',
					answer: answerRecord('ans_1', 'The tool is YukiReserve.'),
				}),
			],
		}),
	);
	assert.equal(answerEdit.discovery?.stale, true);
});

test('step corrections stale discovery and every proposal whose basis includes the graph', () => {
	const previous = baseSession();
	const correctedStep = step('step_1', verifiedTextClaim('Corrected label', [
		evidence('seg_src1', 1, 'types every booking into the PMS'),
	]));
	const next = applyInvalidation(
		previous,
		{
			...previous,
			workflow: {
				...previous.workflow,
				steps: previous.workflow.steps.map((entry) =>
					entry.id === 'step_1' ? correctedStep : entry,
				),
			},
		},
		true,
	);
	assert.equal(next.discovery?.stale, true);
	assert.deepEqual(
		next.proposals.map((entry) => [entry.opportunityId, entry.stale]),
		[['opp_1', true]],
	);
});

test('assumption edits stale only that proposal, not discovery', () => {
	const previous = baseSession();
	const nextSession = makeSession({
		discovery: run('fixture'),
		proposals: [proposal('opp_1', 'plan_1')],
		opportunities: [{
			...makeSession().opportunities[0],
			assumptions: {
				monthlyOccurrences: { value: 10, basis: 'Stated by the clerk.', evidence: [evidence('seg_src1', 1, 'types every booking into the PMS')], edited: true },
				minutesSaved: { value: 6, basis: 'Stated by the clerk.', evidence: [], edited: true },
			},
			hoursSavedPerMonth: 1,
		}],
	});
	const next = applyInvalidation(previous, nextSession);
	assert.equal(next.discovery?.stale, false);
	assert.deepEqual(
		next.proposals.map((entry) => [entry.opportunityId, entry.stale]),
		[['opp_1', true]],
	);
});

test('identical content is a no-op', () => {
	const session = baseSession();
	assert.equal(sameSession(session, makeSession({
		discovery: run('fixture'),
		proposals: [proposal('opp_1', 'plan_1')],
	})), true);
	assert.equal(sameSession(session, { ...session, rev: session.rev + 1 }), false);
	assert.equal(
		sameSession(session, { ...session, title: 'Changed title' }),
		false,
	);
});
