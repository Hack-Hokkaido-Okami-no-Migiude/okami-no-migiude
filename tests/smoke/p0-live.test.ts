// Production-build live-provider smoke: exercise the published HTTP API against
// a loopback OpenAI-compatible stub (no real credentials). Covers the consent
// gate, a successful live discovery + proposal, identical rerun collapsing to
// `unchanged` without provider calls, and malformed/503 failures that leave the
// saved session untouched with no fixture fallback and no revision bump.
import {
	CANNED_ASSESSMENT,
	CANNED_EXTRACTION,
	CANNED_PROPOSAL,
} from '../../server/demo/hotel';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
	type SmokeServer,
	call,
	errorBody,
	freePort,
	removeDataDir,
	startSmokeServer,
} from './helpers/server';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const S = '/api/clients/cli_hotel_demo/sessions/ses_hotel_demo';
const STAGE_MARKERS: Record<string, string> = {
	extract: 'You extract a workflow',
	assess: 'You assess candidate workflow',
	propose: 'You propose an improved workflow',
};
const STAGE_PAYLOADS: Record<string, unknown> = {
	extract: CANNED_EXTRACTION,
	assess: CANNED_ASSESSMENT,
	propose: CANNED_PROPOSAL,
};

type StubMode = 'canned' | 'malformed' | 'unavailable';

type SeenRequest = {
	authorization: string;
	system: string;
	user: string;
};

type StubState = {
	mode: StubMode;
	calls: Record<string, number>;
	/** Last request per stage, for untrusted-data separation assertions. */
	lastRequests: Record<string, SeenRequest>;
};

const stub: StubState = {
	mode: 'canned',
	calls: { extract: 0, assess: 0, propose: 0 },
	lastRequests: {},
};

const callsOf = (operation: string): number => stub.calls[operation] ?? 0;

let stubServer: ReturnType<typeof createServer> | null = null;

const state: { server: SmokeServer | null } = { server: null };

before(async () => {
	const stubPort = await freePort();
	stubServer = createServer(handleStubRequest);
	await new Promise<void>((resolve) => {
		stubServer?.listen(stubPort, '127.0.0.1', () => resolve());
	});
	const baseUrl = `http://127.0.0.1:${stubPort}/v1`;
	state.server = await startSmokeServer({
		live: { baseUrl, apiKey: 'smoke-stub-key', model: 'smoke-stub-model' },
	});
});

after(async () => {
	const dataDir = state.server?.dataDir;
	await state.server?.stop();
	state.server = null;
	stubServer?.closeAllConnections?.();
	await new Promise<void>((resolve) => {
		stubServer?.close(() => resolve());
	});
	if (dataDir) {
		removeDataDir(dataDir);
	}
});

function handleStubRequest(
	request: IncomingMessage,
	response: ServerResponse,
): void {
	let raw = '';
	request.setEncoding('utf8');
	request.on('data', (chunk: string) => {
		raw += chunk;
	});
	request.on('end', () => {
		const body = JSON.parse(raw) as {
			messages?: { role: string; content: string }[];
		};
		const system =
			body.messages?.find((m) => m.role === 'system')?.content ?? '';
		const user =
			body.messages?.find((m) => m.role === 'user')?.content ?? '';
		const operation =
			Object.entries(STAGE_MARKERS).find(([, marker]) =>
				system.startsWith(marker),
			)?.[0] ?? 'unknown';
		stub.calls[operation] = (stub.calls[operation] ?? 0) + 1;
		stub.lastRequests[operation] = {
			authorization: String(request.headers.authorization ?? ''),
			system,
			user,
		};

		if (stub.mode === 'unavailable') {
			response.statusCode = 503;
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ error: 'temporarily unavailable' }));
			return;
		}
		if (stub.mode === 'malformed') {
			response.statusCode = 200;
			response.setHeader('content-type', 'application/json');
			// Well-formed envelope, malformed model content: this must fail as
			// invalid_model_output and never be retried.
			response.end(
				JSON.stringify({
					choices: [
						{
							message: {
								role: 'assistant',
								content: '{not json',
							},
						},
					],
				}),
			);
			return;
		}
		const payload = STAGE_PAYLOADS[operation];
		if (!payload) {
			response.statusCode = 500;
			response.end('{}');
			return;
		}
		response.statusCode = 200;
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify({
				choices: [
					{
						message: {
							role: 'assistant',
							content: JSON.stringify(payload),
						},
					},
				],
			}),
		);
	});
}

test('live consent is required per request and makes no provider call', async () => {
	const server = state.server;
	assert.ok(server, 'the live smoke server must be running');
	await call(server.port, 'POST', '/api/demo/hotel', {});
	const refused = await call(server.port, 'POST', `${S}/analyze`, {
		baseRev: 1,
		mode: 'live',
	});
	assert.equal(refused.status, 422);
	assert.equal(errorBody(refused.body).code, 'consent_required');
	assert.equal(
		callsOf('extract'),
		0,
		'a refused request must not call the provider',
	);
	assert.deepEqual(stub.lastRequests, {});
});

test('a successful live run updates discovery and proposal through the stub', async () => {
	const server = state.server;
	assert.ok(server);
	const { port } = server;

	const analyzed = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 1,
		mode: 'live',
		allowExternal: true,
	});
	assert.equal(analyzed.status, 200, `live analyze failed: ${analyzed.text}`);
	assert.equal((analyzed.body as { outcome?: unknown }).outcome, 'updated');
	const session = (analyzed.body as { session: Record<string, unknown> })
		.session;
	assert.equal(session.rev, 2);
	const discovery = session.discovery as Record<string, unknown>;
	assert.equal(discovery.mode, 'live', 'the run must be recorded as live');
	assert.equal(discovery.stale, false);
	assert.equal(
		((session.workflow as Record<string, unknown>).steps as unknown[])
			.length,
		7,
	);

	// Untrusted interview data travels in the user message, separate from the
	// fixed instructions, and the stub-key stays server-side in the header.
	const seen = stub.lastRequests.extract;
	assert.ok(seen, 'the extract stage must have been called');
	assert.match(seen.authorization, /^Bearer /);
	assert.match(seen.system, /^You extract a workflow/);
	assert.doesNotMatch(seen.system, /YukiReserve/);
	assert.match(seen.user, /UNTRUSTED INTERVIEW DATA/);
	assert.match(seen.user, /YukiReserve/);
	assert.equal(callsOf('extract'), 1);
	assert.equal(callsOf('assess'), 1);
	assert.equal(callsOf('propose'), 0);

	const proposed = await call(
		port,
		'POST',
		`${S}/opportunities/opp_hotel_01/proposal`,
		{
			baseRev: session.rev as number,
			mode: 'live',
			allowExternal: true,
		},
	);
	assert.equal(
		proposed.status,
		200,
		`live proposal failed: ${proposed.text}`,
	);
	assert.equal((proposed.body as { outcome?: unknown }).outcome, 'updated');
	const proposedSession = (
		proposed.body as { session: Record<string, unknown> }
	).session;
	assert.equal(proposedSession.rev, 3);
	const proposal = (
		proposedSession.proposals as Record<string, unknown>[]
	)[0];
	assert.equal(proposal.mode, 'live');
	assert.equal(
		(proposal.plan as Record<string, unknown>).id,
		'plan_hotel_01',
	);
	assert.equal(callsOf('propose'), 1);
});

test('identical live reruns are unchanged with no additional provider calls', async () => {
	const server = state.server;
	assert.ok(server);
	const { port } = server;
	const revBefore = (await call(port, 'GET', S)).body as Record<
		string,
		unknown
	>;

	const rerunDiscovery = await call(port, 'POST', `${S}/analyze`, {
		baseRev: revBefore.rev as number,
		mode: 'live',
		allowExternal: true,
	});
	assert.equal(rerunDiscovery.status, 200);
	assert.equal(
		(rerunDiscovery.body as { outcome?: unknown }).outcome,
		'unchanged',
	);

	const rerunProposal = await call(
		port,
		'POST',
		`${S}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: revBefore.rev as number, mode: 'live', allowExternal: true },
	);
	assert.equal(rerunProposal.status, 200);
	assert.equal(
		(rerunProposal.body as { outcome?: unknown }).outcome,
		'unchanged',
	);

	assert.equal(
		callsOf('extract'),
		1,
		'identical content must not re-call the provider',
	);
	assert.equal(callsOf('assess'), 1);
	assert.equal(callsOf('propose'), 1);
	assert.deepEqual((await call(port, 'GET', S)).body, revBefore);
});

test('malformed provider output fails loudly without fallback or revision change', async () => {
	const server = state.server;
	assert.ok(server);
	const { port } = server;

	// Any consultant edit changes the discovery basis, so the run reaches the
	// provider instead of collapsing onto the unchanged artifact key.
	const currentRev = ((await call(port, 'GET', S)).body as Record<
		string,
		unknown
	>).rev as number;
	const correction = await call(port, 'PATCH', `${S}/steps/step_hotel_02`, {
		baseRev: currentRev,
		fields: {
			label: {
				value: 'Enter reservation into YukiReserve (consultant rewording)',
				evidence: [
					{
						sourceId: 'seg_hotel_02',
						sourceRev: 1,
						quote: 'types them into YukiReserve, our property management system',
					},
				],
			},
		},
		verify: true,
	});
	assert.equal(
		correction.status,
		200,
		`correction failed: ${correction.text}`,
	);
	// The correction route returns the bare session record.
	const correctedRev = (correction.body as Record<string, unknown>).rev as number;
	// The failed run must leave exactly this state on the server.
	const baseline = await call(port, 'GET', S);
	assert.equal(baseline.status, 200);
	assert.equal((baseline.body as Record<string, unknown>).rev, correctedRev);

	stub.mode = 'malformed';
	try {
		const failed = await call(port, 'POST', `${S}/analyze`, {
			baseRev: correctedRev,
			mode: 'live',
			allowExternal: true,
		});
		assert.equal(failed.status, 502);
		assert.equal(errorBody(failed.body).code, 'invalid_model_output');
		assert.equal(
			callsOf('extract'),
			2,
			'malformed content must not be retried',
		);
	} finally {
		stub.mode = 'canned';
	}

	const after = await call(port, 'GET', S);
	assert.equal(after.status, 200);
	assert.deepEqual(
		after.body,
		baseline.body,
		'the failed run must leave the saved session byte-identical (no fallback, no revision bump)',
	);
});

test('a 503 provider is retried once, then fails without touching the session', async () => {
	const server = state.server;
	assert.ok(server);
	const { port } = server;

	// Move the basis again so the run reaches the provider.
	const beforeRev = (await call(port, 'GET', S)).body as Record<
		string,
		unknown
	>;
	const answer = await call(port, 'PUT', `${S}/questions/q_hotel_01/answer`, {
		baseRev: beforeRev.rev as number,
		text: 'Live stub answer for the 503 path.',
	});
	assert.equal(answer.status, 200, `answer failed: ${answer.text}`);
	// The answer route returns the bare session record.
	const answeredRev = (answer.body as Record<string, unknown>).rev as number;
	// The failed run must leave exactly this state on the server (the recorded
	// answer itself is a consultant action and must persist).
	const baseline = await call(port, 'GET', S);
	assert.equal(baseline.status, 200);
	assert.equal((baseline.body as Record<string, unknown>).rev, answeredRev);

	const extractCallsBefore = callsOf('extract');
	stub.mode = 'unavailable';
	try {
		const failed = await call(port, 'POST', `${S}/analyze`, {
			baseRev: answeredRev,
			mode: 'live',
			allowExternal: true,
		});
		assert.equal(failed.status, 502);
		assert.equal(errorBody(failed.body).code, 'provider_failed');
		assert.equal(
			callsOf('extract'),
			extractCallsBefore + 2,
			'exactly one retry for a 5xx provider',
		);
	} finally {
		stub.mode = 'canned';
	}

	const after = await call(port, 'GET', S);
	assert.equal(after.status, 200);
	assert.deepEqual(
		after.body,
		baseline.body,
		'the failed run must leave the saved session byte-identical (no fallback, no revision bump)',
	);
});
