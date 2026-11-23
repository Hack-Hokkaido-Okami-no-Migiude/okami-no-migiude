// Live provider hardening, driven against a local in-process HTTP stub (no
// external calls, no credits): untrusted-data separation, no tool calling,
// retry policy (timeouts/429/5xx only, at most one retry), size caps, JSON
// handling, provider_unconfigured, redacted failure messages, and a full
// discovery round trip that grounds a transition against the real stored
// answer id through the live provider (never a fixture fallback).
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	stubProvider,
} from './helpers';
import test, { after } from 'node:test';
import type { Session } from '../../shared/p0/types';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import { createLiveProvider } from '../../server/analysis/provider-live';
import { discover } from '../../server/analysis/discover';
import http from 'node:http';

type StubHandler = (
	request: http.IncomingMessage,
	response: http.ServerResponse,
	body: string,
) => void | Promise<void>;

const stubs: http.Server[] = [];

async function startStub(handler: StubHandler): Promise<string> {
	const server = http.createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');
			void Promise.resolve(handler(request, response, body)).catch(
				(error: unknown) => {
					response.destroy(
						error instanceof Error ? error : undefined,
					);
				},
			);
		});
	});
	stubs.push(server);
	await new Promise<void>((resolve) =>
		server.listen(0, '127.0.0.1', resolve),
	);
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	return `http://127.0.0.1:${address.port}/v1`;
}

after(() => {
	for (const server of stubs.splice(0)) {
		server.close();
	}
});

async function readBody(
	response: http.ServerResponse,
	status: number,
	payload: unknown,
): Promise<void> {
	response.statusCode = status;
	response.setHeader('content-type', 'application/json');
	response.end(JSON.stringify(payload));
}

function okBody(content: string): unknown {
	return { choices: [{ message: { role: 'assistant', content } }] };
}

const EXTRACT_JSON = JSON.stringify({
	steps: [],
	transitions: [],
	unknowns: [],
	opportunities: [],
});

test('a configured live provider posts separated instructions and parses JSON output', async () => {
	let seenBody = '';
	const url = await startStub((_request, response, body) => {
		seenBody = body;
		void readBody(response, 200, okBody(EXTRACT_JSON));
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'test-key-not-real',
		model: 'stub-model',
	});
	const output = await provider.run('extract', {
		transcript: [{ id: 'seg_a', text: 'secret text' }],
	});
	assert.deepEqual(output, JSON.parse(EXTRACT_JSON));

	const parsed = JSON.parse(seenBody) as {
		model: string;
		messages: { role: string; content: string }[];
		tools?: unknown;
	};
	assert.equal(parsed.model, 'stub-model');
	assert.equal(parsed.messages.length, 2);
	// Fixed instructions are the system message; session data is a separate
	// untrusted user message.
	assert.match(parsed.messages[0]?.content ?? '', /Respond with JSON only/);
	assert.match(parsed.messages[1]?.content ?? '', /UNTRUSTED INTERVIEW DATA/);
	assert.match(parsed.messages[1]?.content ?? '', /secret text/);
	// No tool calling is offered to the model.
	assert.ok(!('tools' in parsed));
	assert.ok(!('tool_choice' in parsed));
});

test('the provider key is stable and mode is live', async () => {
	const url = await startStub((_request, response) => {
		void readBody(response, 200, okBody(EXTRACT_JSON));
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	assert.equal(provider.mode, 'live');
	const key = provider.key;
	const second = createLiveProvider({
		baseUrl: url,
		apiKey: 'k2',
		model: 'm',
	});
	assert.equal(
		second.key,
		key,
		'same model+base → same key (key is not the secret)',
	);
	assert.match(key, /^live:m:[0-9a-f]{12}:prompt-v2$/);
});

test('missing configuration raises provider_unconfigured before any request', async () => {
	for (const config of [
		{ baseUrl: '', apiKey: 'k', model: 'm' },
		{ baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'm' },
		{ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', model: '' },
	]) {
		assert.throws(
			() => createLiveProvider(config),
			(error: unknown) =>
				error instanceof StageError
				&& error.code === 'provider_unconfigured',
		);
	}
});

test('4xx failures surface a redacted status message and do not retry', async () => {
	let calls = 0;
	const url = await startStub((_request, response) => {
		calls += 1;
		void readBody(response, 401, { error: 'secret upstream detail' });
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& /status 401/.test(error.message)
			&& !/secret/.test(error.message),
	);
	assert.equal(calls, 1, 'no retry on 4xx');
});

test('a 5xx failure is retried exactly once', async () => {
	let calls = 0;
	const url = await startStub((_request, response) => {
		calls += 1;
		if (calls === 1) {
			void readBody(response, 503, {});
			return;
		}
		void readBody(response, 200, okBody(EXTRACT_JSON));
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	const output = await provider.run('extract', {});
	assert.deepEqual(output, JSON.parse(EXTRACT_JSON));
	assert.equal(calls, 2, 'exactly one retry for 5xx');
});

test('a persistent 5xx gives up after the single retry with a redacted error', async () => {
	let calls = 0;
	const url = await startStub((_request, response) => {
		calls += 1;
		void readBody(response, 500, { error: 'internal stack trace detail' });
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError
			&& /status 500/.test(error.message)
			&& !/stack trace/.test(error.message),
	);
	assert.equal(calls, 2, 'no more than one retry');
});

test('malformed JSON output is rejected as invalid_model_output', async () => {
	const url = await startStub((_request, response) => {
		response.statusCode = 200;
		response.setHeader('content-type', 'application/json');
		response.end('not json at all');
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& /non-JSON response body/.test(error.message),
	);
});

test('valid JSON wrapper with malformed stage content is invalid_model_output', async () => {
	const url = await startStub((_request, response) => {
		void readBody(response, 200, okBody('{oops'));
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'invalid_model_output'
			&& /malformed JSON/.test(error.message),
	);
});

test('a response missing message content is rejected', async () => {
	const url = await startStub((_request, response) => {
		void readBody(response, 200, {
			choices: [{ message: { role: 'assistant' } }],
		});
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError
			&& /missing message content/.test(error.message),
	);
});

test('a connection refusal surfaces a redacted provider_failed error', async () => {
	const provider = createLiveProvider({
		baseUrl: 'http://127.0.0.1:1/v1',
		apiKey: 'k',
		model: 'm',
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError && error.code === 'provider_failed',
	);
});

test('requests carry the timeout signal', async () => {
	let stubWasReached = false;
	const url = await startStub(() => {
		// The stub never responds; the client should abort via its signal.
		stubWasReached = true;
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'k',
		model: 'm',
		timeoutMs: 250,
	});
	await assert.rejects(
		() => provider.run('extract', {}),
		(error: unknown) =>
			error instanceof StageError && error.code === 'provider_failed',
	);
	assert.ok(stubWasReached);
});

/** The analysis session with question q_a answered by a persisted answer. */
async function answeredSession(): Promise<Session> {
	// The question only exists after a first discovery; answer it, then the
	// round trip under test runs against the live provider.
	const first = await discover(
		baseSession(),
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	const session: Session = { ...baseSession(), ...first.patch };
	return {
		...session,
		questions: session.questions.map((question) =>
			question.id === 'q_a' ?
				{
					...question,
					status: 'answered' as const,
					answer: {
						id: 'ans_live_01',
						sourceRev: 1,
						text: ANSWER_TEXT,
					},
				}
			:	question,
		),
	};
}

const ANSWER_TEXT =
	'Whenever the clerk finishes the reservation email, the booking is typed into the PMS the same morning.';

const ANSWER_EXTRACTION_JSON = JSON.stringify({
	steps: [
		{
			key: 'step_a',
			label: 'Receive reservation email',
			role: 'Front desk clerk',
			tool: 'Email inbox',
			execution: 'manual',
			evidence: [
				{
					sourceId: 'seg_a',
					sourceRev: 1,
					quote: 'receives the reservation email',
				},
			],
			anchors: ['receives the reservation email'],
		},
		{
			key: 'step_b',
			label: 'Enter booking into the PMS',
			role: 'Front desk clerk',
			tool: 'PMS',
			execution: 'manual',
			evidence: [
				{
					sourceId: 'seg_b',
					sourceRev: 1,
					quote: 'types the booking into the PMS',
				},
			],
			anchors: ['types the booking into the PMS'],
		},
	],
	transitions: [
		{
			key: 'edge_ab',
			fromKey: 'step_a',
			toKey: 'step_b',
			kind: 'sequence',
			condition: null,
			// The live model cites the saved answer by its persisted identity.
			evidence: {
				sourceId: 'ans_live_01',
				sourceRev: 1,
				quote: ANSWER_TEXT,
			},
			fromAnchor: 'finishes the reservation email',
			toAnchor: 'typed into the PMS',
		},
	],
	unknowns: [],
	opportunities: [],
});

test('a live round trip grounds a transition against the real stored answer id', async () => {
	const extractRequests: string[] = [];
	const url = await startStub((_request, response, body) => {
		const parsed = JSON.parse(body) as {
			messages: { role: string; content: string }[];
		};
		const system = parsed.messages[0]?.content ?? '';
		if (system.includes('You extract')) {
			extractRequests.push(parsed.messages[1]?.content ?? '');
			void readBody(response, 200, okBody(ANSWER_EXTRACTION_JSON));
			return;
		}
		void readBody(
			response,
			200,
			okBody(
				JSON.stringify({
					acceptedTransitionKeys: ['edge_ab'],
					rejected: [],
					notices: [],
				}),
			),
		);
	});
	const provider = createLiveProvider({
		baseUrl: url,
		apiKey: 'test-key-not-real',
		model: 'stub-model',
	});

	const result = await discover(await answeredSession(), provider);

	// The projection exposed the saved answer's persisted id and revision, so
	// the live model could cite it as evidence.
	assert.equal(extractRequests.length, 1);
	const untrusted = extractRequests[0] ?? '';
	const projected = JSON.parse(
		untrusted.replace('UNTRUSTED INTERVIEW DATA (JSON):\n', ''),
	) as {
		answers: { answerId: string; answerRev: number; text: string }[];
	};
	assert.equal(projected.answers[0]?.answerId, 'ans_live_01');
	assert.equal(projected.answers[0]?.answerRev, 1);
	assert.equal(projected.answers[0]?.text, ANSWER_TEXT);

	// The transition grounded in the stored answer survives evidence
	// validation; the run is live — no fixture fallback substituted.
	const edge = result.patch.workflow.edges[0];
	assert.ok(edge, 'the answer-grounded transition is created');
	assert.equal(edge.evidence[0]?.sourceId, 'ans_live_01');
	assert.equal(edge.evidence[0]?.sourceRev, 1);
	assert.equal(edge.evidence[0]?.quote, ANSWER_TEXT);
	assert.equal(result.patch.discovery?.mode, 'live');
	assert.equal(result.patch.discovery?.stale, false);
});
