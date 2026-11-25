// Unit tests for the interview API client: wire shapes, error envelope
// mapping and response shape validation (contract §3–§6).
import assert from 'node:assert/strict';
import { createInterviewClient } from '../app/utils/interview-api.ts';
import test from 'node:test';

const INTERVIEW = {
	id: 'interview-1',
	status: 'active',
	deadlineAt: '2026-11-25T09:00:00.000Z',
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

test('start sends exactly the recorded demo consent payload', async () => {
	const http = fakeHttp();
	http.enqueue({ status: 201, json: { interview: INTERVIEW } });
	const client = createInterviewClient(http);
	const result = await client.start();
	assert.deepEqual(http.calls, [
		{
			path: '/api/interviews/start',
			method: 'POST',
			body: { consent: true, mode: 'demo' },
		},
	]);
	assert.deepEqual(result, { interview: INTERVIEW });
});

test('current sends GET without a body and validates the shape', async () => {
	const http = fakeHttp();
	http.enqueue({
		status: 200,
		json: { interview: null, reportId: null },
	});
	const client = createInterviewClient(http);
	assert.deepEqual(await client.current(), {
		interview: null,
		reportId: null,
	});

	http.enqueue({
		status: 200,
		json: { interview: INTERVIEW, reportId: null },
	});
	assert.deepEqual(await client.current(), {
		interview: INTERVIEW,
		reportId: null,
	});

	http.enqueue({ status: 200, json: {} });
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.ok(error instanceof Error);
			assert.equal(error.code, 'internal');
			return true;
		},
	);
});

test('complete posts the transcript and returns interview + report', async () => {
	const http = fakeHttp();
	http.enqueue({
		status: 200,
		json: { interview: INTERVIEW, reportId: 'report-1' },
	});
	const client = createInterviewClient(http);
	const result = await client.complete('interview-1', 'transcript text');
	assert.deepEqual(http.calls, [
		{
			path: '/api/interviews/interview-1/complete',
			method: 'POST',
			body: { transcript: 'transcript text' },
		},
	]);
	assert.deepEqual(result, { interview: INTERVIEW, reportId: 'report-1' });
});

test('error envelope is mapped to typed failures', async () => {
	const http = fakeHttp();
	http.enqueue({
		status: 409,
		json: { error: 'interview_expired', message: 'too late' },
	});
	const client = createInterviewClient(http);
	await assert.rejects(
		() => client.complete('i', 't'),
		(error) => {
			assert.equal(error.code, 'interview_expired');
			assert.equal(error.status, 409);
			assert.equal(error.message, 'too late');
			return true;
		},
	);

	// Non-JSON or envelope-less error bodies fall back to `internal`.
	http.enqueue({ status: 500, json: 'boom' });
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.equal(error.code, 'internal');
			assert.equal(error.status, 500);
			return true;
		},
	);

	http.enqueue({ status: 401, json: null });
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.equal(error.code, 'internal');
			assert.equal(error.status, 401);
			return true;
		},
	);
});

test('network failures map to the network code', async () => {
	const http = fakeHttp();
	http.enqueue({ status: 0, json: null, networkError: true });
	const client = createInterviewClient(http);
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.equal(error.code, 'network');
			assert.equal(error.status, 0);
			return true;
		},
	);

	// A throwing http transport is treated the same way.
	const throwing = () => {
		throw new Error('offline');
	};
	await assert.rejects(
		() => createInterviewClient(throwing).current(),
		(error) => {
			assert.equal(error.code, 'network');
			return true;
		},
	);
});
