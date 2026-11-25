// Unit tests for the interview flow state machine: consent gating, start,
// resume, deadline hard cut, submit and restart against a fake http client.
import assert from 'node:assert/strict';
import { createDraftStore } from '../app/utils/interview-draft.ts';
import { createInterviewClient } from '../app/utils/interview-api.ts';
import { createInterviewFlow } from '../app/composables/useInterviewFlow.ts';
import test from 'node:test';

const DEADLINE = '2026-11-25T09:00:00.000Z';
const DEADLINE_MS = Date.parse(DEADLINE);

const ACTIVE = {
	id: 'interview-1',
	status: 'active',
	deadlineAt: DEADLINE,
	mode: 'demo',
};
const SUBMITTED = {
	id: 'interview-1',
	status: 'submitted',
	deadlineAt: DEADLINE,
	mode: 'demo',
};

function fakeHttp() {
	const calls = [];
	const queue = [];
	async function http(path, init) {
		calls.push({
			path,
			method: init.method,
			body: init.body === undefined ? null : init.body,
		});
		const next = queue.shift();
		if (!next) {
			throw new Error(`unexpected call: ${init.method} ${path}`);
		}
		return typeof next === 'function' ? next(calls.at(-1)) : next;
	}
	http.calls = calls;
	http.enqueue = (response) => {
		queue.push(response);
	};
	return http;
}

function memoryStorage() {
	const map = new Map();
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

function buildFlow({ nowMs = DEADLINE_MS - 3_600_000, storage } = {}) {
	const http = fakeHttp();
	const clock = { nowMs };
	const flow = createInterviewFlow({
		client: createInterviewClient(http),
		now: () => clock.nowMs,
		draft: createDraftStore(storage ?? memoryStorage()),
	});
	return { flow, http, clock, setNow: (ms) => (clock.nowMs = ms) };
}

function currentResponse(interview, reportId) {
	return {
		status: 200,
		json: { interview, reportId: reportId ?? null },
	};
}

test('init: no interview → intro with a fresh consent gate', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	assert.equal(flow.phase.value, 'intro');
	assert.equal(flow.interview.value, null);
	assert.deepEqual(flow.consents.value, {
		processing: false,
		privacy: false,
		staff: false,
	});
	assert.equal(flow.canStart.value, false);
});

test('init: active interview resumes with the saved draft', async () => {
	const storage = memoryStorage();
	storage.setItem('interview-draft:interview-1', 'saved draft');
	const { flow, http } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	assert.equal(flow.phase.value, 'active');
	assert.equal(flow.transcript.value, 'saved draft');
	assert.equal(flow.deadlineAt.value, DEADLINE);
});

test('init: submitted interview shows the report state', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(SUBMITTED, 'report-9'));
	await flow.init();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-9');
});

test('init: load failure lands in the retryable unavailable state', async () => {
	const { flow, http } = buildFlow();
	http.enqueue({ status: 0, json: null, networkError: true });
	await flow.init();
	assert.equal(flow.phase.value, 'unavailable');
	// A later retry can recover.
	http.enqueue(currentResponse(null));
	await flow.init();
	assert.equal(flow.phase.value, 'intro');
});

test('start is refused until every disclosure is acknowledged', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	http.enqueue({ status: 201, json: { interview: ACTIVE } });
	await flow.start();
	assert.deepEqual(http.calls, [
		{ path: '/api/interviews/current', method: 'GET', body: null },
	]);
	assert.equal(flow.phase.value, 'consent');

	flow.consents.value = {
		processing: true,
		privacy: true,
		staff: false,
	};
	await flow.start();
	assert.equal(http.calls.length, 1, 'no start call yet');
	assert.equal(flow.phase.value, 'consent');

	flow.consents.value = {
		processing: true,
		privacy: true,
		staff: true,
	};
	await flow.start();
	assert.deepEqual(http.calls[1], {
		path: '/api/interviews/start',
		method: 'POST',
		body: { consent: true, mode: 'demo' },
	});
	assert.equal(flow.phase.value, 'active');
	assert.equal(flow.deadlineAt.value, DEADLINE);
	assert.equal(flow.error.value, null);
});

test('start 409 already_submitted falls back to the submitted state', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	http.enqueue({ status: 409, json: { error: 'already_submitted' } });
	http.enqueue(currentResponse(SUBMITTED, 'report-2'));
	await flow.start();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-2');
	assert.equal(http.calls.length, 3);
});

test('start 409 interview_active resumes the running interview', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	http.enqueue({ status: 409, json: { error: 'interview_active' } });
	http.enqueue(currentResponse(ACTIVE));
	await flow.start();
	assert.equal(flow.phase.value, 'active');
	assert.equal(flow.deadlineAt.value, DEADLINE);
});

test('start 409 mode_unavailable keeps the gate open with an error', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	flow.consents.value = { processing: true, privacy: true, staff: true };
	http.enqueue({ status: 409, json: { error: 'mode_unavailable' } });
	await flow.start();
	assert.equal(flow.phase.value, 'consent');
	assert.equal(flow.error.value, 'mode_unavailable');
});

test('submit validates the transcript before touching the network', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();

	flow.onTranscriptInput('   \n  ');
	await flow.submit();
	assert.deepEqual(http.calls, [
		{ path: '/api/interviews/current', method: 'GET', body: null },
	]);
	assert.equal(flow.phase.value, 'active');

	flow.onTranscriptInput('a'.repeat(200_001));
	await flow.submit();
	assert.equal(http.calls.length, 1);
	assert.equal(flow.phase.value, 'active');
});

test('submit sends the transcript, reports success and clears the draft', async () => {
	const storage = memoryStorage();
	const { flow, http } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('面接者: こんにちは\n経営者: よろしく');
	http.enqueue({
		status: 200,
		json: { interview: SUBMITTED, reportId: 'report-5' },
	});
	await flow.submit();
	assert.deepEqual(http.calls[1], {
		path: '/api/interviews/interview-1/complete',
		method: 'POST',
		body: { transcript: '面接者: こんにちは\n経営者: よろしく' },
	});
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-5');
	assert.equal(storage.getItem('interview-draft:interview-1'), null);
});

test('submit checks the deadline again immediately before sending', async () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('late attempt');
	setNow(DEADLINE_MS + 1);
	// The timer has not fired markDeadlinePassed yet, but the hard cut must
	// still be enforced at the moment the request would be sent.
	await flow.submit();
	assert.equal(http.calls.length, 1, 'no complete call after expiry');
	assert.equal(flow.phase.value, 'expired');
});

test('submit 409 interview_expired lands in the expired state', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('draft');
	http.enqueue({ status: 409, json: { error: 'interview_expired' } });
	await flow.submit();
	assert.equal(flow.phase.value, 'expired');
});

test('submit 409 already_submitted re-checks and shows the report', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('draft');
	http.enqueue({ status: 409, json: { error: 'already_submitted' } });
	http.enqueue(currentResponse(SUBMITTED, 'report-7'));
	await flow.submit();
	assert.equal(flow.phase.value, 'submitted');
	assert.equal(flow.reportId.value, 'report-7');
});

test('submit network failure restores active state and keeps the text', async () => {
	const storage = memoryStorage();
	const { flow, http } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('keep me');
	http.enqueue({ status: 0, json: null, networkError: true });
	await flow.submit();
	assert.equal(flow.phase.value, 'active');
	assert.equal(flow.error.value, 'network');
	assert.equal(flow.transcript.value, 'keep me');
	assert.equal(
		storage.getItem('interview-draft:interview-1'),
		'keep me',
		'transcript survives a failed submit',
	);
});

test('a network failure after the deadline lands in expired, not active', async () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	flow.onTranscriptInput('keep me');
	http.enqueue({ status: 0, json: null, networkError: true });
	const submitting = flow.submit();
	// Deadline passes while the submit request is in flight.
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	await submitting;
	// The in-flight attempt failed; the deadline has passed, so the flow must
	// not pretend the interview is still editable.
	assert.equal(flow.phase.value, 'expired');
	assert.equal(flow.error.value, 'network');
});

test('markDeadlinePassed stops transcript edits and clears the draft', () => {
	const storage = memoryStorage();
	const { flow, http, setNow } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	flow.phase.value = 'active';
	flow.interview.value = ACTIVE;
	flow.onTranscriptInput('draft');
	assert.equal(flow.transcript.value, 'draft');
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	assert.equal(flow.phase.value, 'expired');
	const appended = flow.appendTranscript('late line');
	assert.equal(appended, false, 'late transcript events are rejected');
	assert.equal(flow.transcript.value, 'draft');
	assert.equal(storage.getItem('interview-draft:interview-1'), null);
});

test('appendTranscript accumulates scripted lines and saves drafts', () => {
	const storage = memoryStorage();
	const { flow, http } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	flow.phase.value = 'active';
	flow.interview.value = ACTIVE;
	assert.equal(flow.appendTranscript('面接者: こんにちは'), true);
	assert.equal(flow.appendTranscript('経営者: どうぞ'), true);
	assert.equal(flow.transcript.value, '面接者: こんにちは\n経営者: どうぞ');
	assert.equal(
		storage.getItem('interview-draft:interview-1'),
		'面接者: こんにちは\n経営者: どうぞ',
	);
});

test('restart after expiry: no interview → a fresh consent gate', async () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	http.enqueue(currentResponse(null));
	await flow.restart();
	assert.equal(flow.phase.value, 'intro');
	assert.deepEqual(flow.consents.value, {
		processing: false,
		privacy: false,
		staff: false,
	});
});

test('restart after expiry: server still active → resume', async () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	// Clock skew: the server may still consider the interview open.
	http.enqueue(
		currentResponse({ ...ACTIVE, deadlineAt: '2026-12-01T09:00:00.000Z' }),
	);
	await flow.restart();
	assert.equal(flow.phase.value, 'active');
	assert.equal(flow.deadlineAt.value, '2026-12-01T09:00:00.000Z');
});

test('restart failure is visible and retryable', async () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	http.enqueue({ status: 0, json: null, networkError: true });
	await flow.restart();
	assert.equal(flow.phase.value, 'unavailable');
});

test('beginConsent moves intro → consent without network calls', async () => {
	const { flow, http } = buildFlow();
	http.enqueue(currentResponse(null));
	await flow.init();
	flow.beginConsent();
	assert.equal(flow.phase.value, 'consent');
	assert.equal(http.calls.length, 1);
});

test('notifySession gates by role before any interview call', async () => {
	const { flow, http } = buildFlow();
	await flow.notifySession(null);
	assert.equal(flow.phase.value, 'signed-out');
	assert.equal(http.calls.length, 0);

	await flow.notifySession({
		id: 'staff-1',
		role: 'staff',
		profile: { name: 'Staff Hanako', email: 'staff@example.test' },
	});
	assert.equal(flow.phase.value, 'staff');
	assert.equal(http.calls.length, 0);

	http.enqueue(currentResponse(ACTIVE));
	await flow.notifySession({
		id: 'owner-1',
		role: 'owner',
		profile: {
			name: 'Owner Taro',
			email: 'owner@example.test',
			businessName: 'Test Inn',
			businessType: 'accommodation',
			otherBusinessType: null,
			municipality: 'Test Town',
			phone: null,
			website: null,
			note: null,
			locale: 'ja',
		},
	});
	assert.equal(flow.phase.value, 'active');
});

test('replaceTranscript and clearTranscript respect the hard cut', () => {
	const { flow, http, setNow } = buildFlow();
	http.enqueue(currentResponse(ACTIVE));
	flow.phase.value = 'active';
	flow.interview.value = ACTIVE;

	assert.equal(flow.replaceTranscript('replaced text'), true);
	assert.equal(flow.transcript.value, 'replaced text');
	setNow(DEADLINE_MS + 1);
	flow.markDeadlinePassed();
	assert.equal(flow.replaceTranscript('late text'), false);
	assert.equal(flow.transcript.value, 'replaced text');
	flow.clearTranscript();
	assert.equal(flow.transcript.value, 'replaced text', 'clear is also cut');
});

test('resuming an active interview flags a restored draft', async () => {
	const storage = memoryStorage();
	storage.setItem('interview-draft:interview-1', 'restored text');
	const { flow, http } = buildFlow({ storage });
	http.enqueue(currentResponse(ACTIVE));
	await flow.init();
	assert.equal(flow.draftRestored.value, true);

	const { flow: emptyFlow, http: emptyHttp } = buildFlow();
	emptyHttp.enqueue(currentResponse(ACTIVE));
	await emptyFlow.init();
	assert.equal(emptyFlow.draftRestored.value, false);
});
