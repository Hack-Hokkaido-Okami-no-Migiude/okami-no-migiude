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
function fakeClient({ availability, current, start, currentQueue = [] }) {
	let currentCalls = 0;
	let firstCurrent = true;
	return {
		async availability() {
			if (availability instanceof ApiFailure) {
				throw availability;
			}
			return availability ?? AGENT_AVAILABLE;
		},
		async current() {
			// The first call answers with `current`; later calls consume the
			// scripted queue (used to step through poll responses).
			if (!firstCurrent && currentQueue.length > 0) {
				const next = currentQueue.shift();
				if (next instanceof ApiFailure) {
					throw next;
				}
				currentCalls += 1;
				return next;
			}
			firstCurrent = false;
			if (current instanceof ApiFailure) {
				throw current;
			}
			currentCalls += 1;
			return current ?? { interview: null, reportId: null };
		},
		async start() {
			if (start instanceof ApiFailure) {
				throw start;
			}
			if (typeof start === 'function') {
				return await start();
			}
			return start ?? { interview: LIVE_INTERVIEW };
		},
		currentCallCount: () => currentCalls,
	};
}

test('an unconfigured agent shows the honest unavailable state', async () => {
	const client = fakeClient({ availability: AGENT_UNAVAILABLE });
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'agent-unavailable');
	assert.equal(flow.availability.value?.agentAvailable, false);

	// The honest state is not retryable via refresh(): the deployment has no
	// agent, so nothing polls and nothing is called.
	await flow.refresh();
	await flow.refresh();
	assert.equal(flow.phase.value, 'agent-unavailable');
	assert.equal(client.currentCallCount(), 0);
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

test('the widget never starts before the consent gate completes', async () => {
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
	assert.equal(flow.phase.value, 'intro');

	flow.beginConsent();
	assert.equal(flow.phase.value, 'consent');

	// Consents missing: the gate cannot send.
	flow.consents.value = emptyConsents();
	await flow.start();
	assert.equal(started, 0);
	assert.equal(flow.phase.value, 'consent');

	// All three consents given: exactly one live start fires.
	flow.consents.value = { processing: true, privacy: true, staff: true };
	await flow.start();
	assert.equal(started, 1);
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.interview.value?.id, 'interview-live-1');
	assert.equal(flow.research.value?.status, 'queued');
	assert.equal(flow.assessment.value?.status, 'idle');
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
});

test('an active live interview resumes in the call view', async () => {
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');
	assert.equal(flow.interview.value?.mode, 'live');
});

test('an active demo interview is reported honestly, not driven', async () => {
	const client = fakeClient({
		current: { interview: DEMO_INTERVIEW, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'demo-active');
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

test('notifyCallEnded moves the live view into the monitoring state', async () => {
	const client = fakeClient({
		current: { interview: LIVE_INTERVIEW, reportId: null },
	});
	const flow = createInterviewFlow({ client });
	await flow.notifySession(OWNER);
	assert.equal(flow.phase.value, 'live');
	flow.notifyCallEnded();
	assert.equal(flow.phase.value, 'ended');

	// Ending twice is a no-op, and the ended view can re-probe.
	flow.notifyCallEnded();
	assert.equal(flow.phase.value, 'ended');
	await flow.restart();
	assert.equal(flow.phase.value, 'live');
});
