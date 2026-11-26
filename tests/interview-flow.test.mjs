// Unit tests for the interview flow state machine of the agent surface:
// consent-before-start, the honest agent-unavailable state, live start,
// resume, the post-call monitoring transitions and the demo-active guard.
// The machine is pure: the API client and the session user are injected, so
// no browser build is required.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiFailure } from '../app/utils/interview-api.ts';
import { createInterviewFlow } from '../app/composables/useInterviewFlow.ts';
import { emptyConsents } from '../app/utils/interview-consent.ts';

const OWNER = { id: 'u1', role: 'owner', profile: {} };

const LIVE_INTERVIEW = {
	id: 'interview-live-1',
	status: 'active',
	deadlineAt: '2026-11-25T09:00:00.000Z',
	mode: 'live',
	research: { status: 'queued', started: false, cases: null },
	assessment: { status: 'idle', reportId: null },
};

const DEMO_INTERVIEW = {
	id: 'interview-demo-1',
	status: 'active',
	deadlineAt: '2026-11-25T09:00:00.000Z',
	mode: 'demo',
};

const SUBMITTED_LIVE = {
	...LIVE_INTERVIEW,
	status: 'submitted',
	assessment: { status: 'completed', reportId: 'report-1' },
};

const AGENT_AVAILABLE = {
	available: true,
	agentAvailable: true,
	reportEngineAvailable: true,
	agentId: 'agent_stub',
};

const AGENT_UNAVAILABLE = {
	available: false,
	agentAvailable: false,
	reportEngineAvailable: false,
	agentId: '',
};

/** A scripted InterviewClient double: each method maps a key to a value. */
function fakeClient({ availability, current, start, mint, currentQueue = [] }) {
	let availabilityCalls = 0;
	let currentCalls = 0;
	let startCalls = 0;
	let mintCalls = 0;
	return {
		async availability() {
			availabilityCalls += 1;
			if (availability instanceof ApiFailure) {
				throw availability;
			}
			return availability ?? AGENT_AVAILABLE;
		},
		async current() {
			// The first call answers with `current`; later calls consume the
			// scripted queue (used to step through poll responses).
			currentCalls += 1;
			const result =
				currentCalls > 1 && currentQueue.length > 0 ?
					currentQueue.shift()
				:	current;
			if (result instanceof ApiFailure) {
				throw result;
			}
			return result ?? { interview: null, reportId: null };
		},
		async start() {
			startCalls += 1;
			if (start instanceof ApiFailure) {
				throw start;
			}
			if (typeof start === 'function') {
				return await start();
			}
			return start ?? { interview: LIVE_INTERVIEW };
		},
		async mintConversation() {
			mintCalls += 1;
			if (mint instanceof ApiFailure) {
				throw mint;
			}
			if (typeof mint === 'function') {
				return await mint();
			}
			return (
				mint ?? { conversationId: 'conv-1', conversationToken: 'tok-1' }
			);
		},
		availabilityCallCount: () => availabilityCalls,
		currentCallCount: () => currentCalls,
		startCallCount: () => startCalls,
		mintCallCount: () => mintCalls,
	};
}

test('an unconfigured agent shows the honest unavailable state', async () => {
	const client = fakeClient({ availability: AGENT_UNAVAILABLE });
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'agent-unavailable');
	assert.equal(flow.availability.value?.agentAvailable, false);

	// The honest state is not retryable via refresh(): the deployment has no
	// agent, so nothing polls and no further current fetches happen (the
	// one init-time fetch checks for an already-finished interview first).
	const currentCallsAfterInit = client.currentCallCount();
	await flow.refresh();
	await flow.refresh();
	assert.equal(flow.phase.value, 'agent-unavailable');
	assert.equal(client.currentCallCount(), currentCallsAfterInit);
});

test('an availability probe failure keeps the generic retryable state', async () => {
	const client = fakeClient({
		availability: new ApiFailure(0, 'network'),
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'unavailable');
	assert.equal(flow.availability.value, null);
});

test('a signed-out or staff session routes before any probe', async () => {
	const client = fakeClient({});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(null);
	assert.equal(flow.phase.value, 'signed-out');
	await flow.notifySession({ id: 's1', role: 'staff', profile: {} });
	assert.equal(flow.phase.value, 'staff');
	// No availability probe and no current call happened.
	assert.equal(client.currentCallCount(), 0);
});

test('the conversation is never minted or started before the consent gate completes', async () => {
	let started = 0;
	const client = fakeClient({
		start: async () => {
			started += 1;
			return { interview: LIVE_INTERVIEW };
		},
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'intro');

	// start() is ignored outside the consent phase — even with consents set.
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(started, 0);
	assert.equal(client.mintCallCount(), 0);
	assert.equal(flow.phase.value, 'intro');

	flow.beginConsent();
	assert.equal(flow.phase.value, 'consent');

	// Consents missing: the gate cannot send.
	flow.consents.value = emptyConsents();
	await flow.start();
	assert.equal(started, 0);
	assert.equal(client.mintCallCount(), 0);
	assert.equal(flow.phase.value, 'consent');

	// All three consents given: exactly one live start fires, followed by
	// the conversation mint for the created interview.
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(started, 1);
	assert.equal(client.mintCallCount(), 1);
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.interview.value?.id, 'interview-live-1');
	assert.equal(flow.conversation.value?.conversationToken, 'tok-1');
	assert.equal(flow.research.value?.status, 'queued');
	assert.equal(flow.assessment.value?.status, 'idle');
});

test('a failed mint leaves the live view with the error and no grant', async () => {
	const client = fakeClient({
		currentQueue: [{ interview: LIVE_INTERVIEW, reportId: null }],
		mint: new ApiFailure(409, 'no_active_interview'),
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'intro');
	assert.equal(client.mintCallCount(), 0);
	flow.beginConsent();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.conversation.value, null);
	assert.equal(flow.error.value, 'internal');
	assert.equal(client.mintCallCount(), 1);

	// Checking status after leaving the call view does not retry the mint.
	flow.notifyCallEnded();
	await flow.refresh();
	assert.equal(flow.phase.value, 'ended');
	assert.equal(flow.conversation.value, null);
	assert.equal(client.mintCallCount(), 1);
});

test('a separate visit can resume an active interview after a failed mint', async () => {
	let mints = 0;
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
		mint: () => {
			mints += 1;
			if (mints === 1) {
				throw new ApiFailure(503, 'upstream');
			}
			return { conversationId: 'conv-2', conversationToken: 'tok-2' };
		},
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	// The resumed live interview mints immediately; the failure surfaces as
	// the live view's error.
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.error.value, 'internal');
	flow.notifyCallEnded();
	const revisitedFlow = createInterviewFlow({ client });
	await revisitedFlow.notifySession(OWNER);
	assert.equal(revisitedFlow.phase.value, 'live');
	assert.equal(revisitedFlow.interview.value?.id, LIVE_INTERVIEW.id);
	assert.equal(revisitedFlow.error.value, null);
	assert.equal(revisitedFlow.conversation.value?.conversationId, 'conv-2');
});

test('mode_unavailable at start falls back to the honest unavailable state', async () => {
	const client = fakeClient({
		start: new ApiFailure(409, 'mode_unavailable'),
		current: { interview: null, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	flow.beginConsent();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(flow.phase.value, 'agent-unavailable');
});

test('conflicts at start reload the current interview', async () => {
	const client = fakeClient({
		start: new ApiFailure(409, 'already_submitted'),
		current: { interview: null, reportId: null },
		currentQueue: [{ interview: SUBMITTED_LIVE, reportId: 'report-1' }],
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	flow.beginConsent();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-1');
	assert.equal(flow.assessment.value?.reportId, 'report-1');
	// A submitted interview is never minted a conversation.
	assert.equal(client.mintCallCount(), 0);
});

test('an active live interview resumes in the call view', async () => {
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.interview.value?.mode, 'live');
	// The resume mints a fresh conversation for the same interview row.
	assert.equal(client.mintCallCount(), 1);
	assert.equal(flow.conversation.value?.conversationId, 'conv-1');
});

test('an active demo interview is reported honestly, not driven', async () => {
	const client = fakeClient({
		current: { interview: DEMO_INTERVIEW, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'demo-active');
	assert.equal(client.mintCallCount(), 0);
});

test('the poll follows research, submission and the report', async () => {
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
		currentQueue: [
			{
				interview: {
					...LIVE_INTERVIEW,
					research: {
						status: 'completed',
						started: true,
						cases: [{ title: 'case' }],
					},
				},
				reportId: null,
			},
			{ interview: SUBMITTED_LIVE, reportId: 'report-1' },
		],
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');

	await flow.refresh();
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.research.value?.status, 'completed');
	assert.deepEqual(flow.research.value?.cases, [{ title: 'case' }]);

	await flow.refresh();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-1');

	// Polls outside the monitoring phases are ignored entirely.
	flow.phase.value = 'intro';
	await flow.refresh();
	assert.equal(client.currentCallCount(), 3);
});

test('refresh swallows network blips instead of dropping the call view', async () => {
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
		currentQueue: [new ApiFailure(0, 'network')],
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');
	await flow.refresh();
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.error.value, null);
});

test('ended status refresh waits for submission without starting another call', async () => {
	const activeStatus = { interview: LIVE_INTERVIEW, reportId: null };
	const client = fakeClient({
		current: activeStatus,
		currentQueue: [
			activeStatus,
			new ApiFailure(0, 'network'),
			activeStatus,
			{ interview: SUBMITTED_LIVE, reportId: 'report-1' },
		],
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');
	assert.notEqual(flow.conversation.value, null);
	flow.notifyCallEnded();
	assert.equal(flow.phase.value, 'ended');
	assert.equal(flow.conversation.value, null);

	// Ending twice is a no-op.
	flow.notifyCallEnded();
	assert.equal(flow.phase.value, 'ended');

	for (const response of ['active', 'network failure', 'active again']) {
		await flow.refresh();
		assert.equal(flow.phase.value, 'ended', response);
		assert.equal(flow.interview.value?.id, LIVE_INTERVIEW.id, response);
		assert.equal(flow.interview.value?.status, 'active', response);
		assert.equal(flow.error.value, null, response);
		assert.equal(flow.reportId.value, null, response);
		assert.equal(flow.conversation.value, null, response);
		assert.equal(client.mintCallCount(), 1, response);
	}

	await flow.refresh();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-1');
	assert.equal(flow.assessment.value?.reportId, 'report-1');
	assert.equal(flow.conversation.value, null);
	assert.equal(client.currentCallCount(), 5);
	assert.equal(client.availabilityCallCount(), 1);
	assert.equal(client.startCallCount(), 0);
	assert.equal(client.mintCallCount(), 1);
});
