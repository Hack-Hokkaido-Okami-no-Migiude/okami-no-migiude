// Unit tests for the interview API client of the agent surface: wire
// shapes, error envelope mapping and response shape validation. The client
// always starts mode 'live' with a boolean consent; the transcript is never
// submitted from the page (the post-call webhook delivers it).
import assert from 'node:assert/strict';
import { createInterviewClient } from '../app/utils/interview-api.ts';
import test from 'node:test';

const INTERVIEW = {
	id: 'interview-1',
	status: 'active',
	deadlineAt: '2026-11-25T09:00:00.000Z',
	mode: 'live',
	research: { status: 'queued', started: false, cases: null },
	assessment: { status: 'idle', reportId: null },
};

const AVAILABILITY = {
	available: true,
	agentAvailable: true,
	reportEngineAvailable: true,
	agentId: 'agent_stub',
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

test('start sends exactly the live consent payload', async () => {
	const http = fakeHttp();
	http.enqueue({ status: 201, json: { interview: INTERVIEW } });
	const client = createInterviewClient(http);
	const result = await client.start();
	assert.deepEqual(http.calls, [
		{
			path: '/api/interviews/start',
			method: 'POST',
			body: { consent: true, mode: 'live' },
		},
	]);
	assert.deepEqual(result, { interview: INTERVIEW });
});

test('availability validates the config shape', async () => {
	const http = fakeHttp();
	http.enqueue({ status: 200, json: AVAILABILITY });
	const client = createInterviewClient(http);
	assert.deepEqual(await client.availability(), AVAILABILITY);

	http.enqueue({ status: 200, json: { available: true } });
	await assert.rejects(
		() => client.availability(),
		(error) => {
			assert.equal(error.code, 'internal');
			return true;
		},
	);

	http.enqueue({ status: 503, json: null });
	await assert.rejects(
		() => client.availability(),
		(error) => {
			assert.equal(error.code, 'internal');
			assert.equal(error.status, 503);
			return true;
		},
	);
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

test('current rejects malformed live surfaces', async () => {
	const http = fakeHttp();
	const client = createInterviewClient(http);

	http.enqueue({
		status: 200,
		json: {
			interview: {
				...INTERVIEW,
				research: { status: 'sprinting', started: false, cases: null },
			},
			reportId: null,
		},
	});
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.equal(error.code, 'internal');
			return true;
		},
	);

	http.enqueue({
		status: 200,
		json: {
			interview: {
				...INTERVIEW,
				assessment: { status: 'completed', reportId: 42 },
			},
			reportId: null,
		},
	});
	await assert.rejects(
		() => client.current(),
		(error) => {
			assert.equal(error.code, 'internal');
			return true;
		},
	);
});

test('error envelope is mapped to typed failures', async () => {
	const http = fakeHttp();
	http.enqueue({
		status: 409,
		json: { error: 'already_submitted', message: 'too late' },
	});
	const client = createInterviewClient(http);
	await assert.rejects(
		() => client.start(),
		(error) => {
			assert.equal(error.code, 'already_submitted');
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
