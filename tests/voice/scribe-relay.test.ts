// Relay integration tests: the real dialer (native Node WebSocket) against a
// loopback `ws` server bound to 127.0.0.1 — exact handshake URL and headers,
// the session_started gate, the end-to-end chunk/commit round trip, provider
// close and error paths, and refusal of a redirecting handshake. No external
// network is touched.
import { type FakeScribeServer, frameCollector, startFakeScribeServer } from './helpers/fake-scribe-server';
import { type ScribeEvent, connectScribeSession } from '../../server/voice/scribe';
import test, { after } from 'node:test';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import { testConfig } from './helpers/test-config';

const openServers: FakeScribeServer[] = [];
after(async () => {
	for (const server of openServers.splice(0)) {
		await server.close();
	}
});

function shortTimeouts() {
	return {
		timeouts: {
			socketOpenMs: 250,
			ttsMs: 1_000,
			finalizeWaitMs: 100,
			idleAudioMs: 100,
			maxSessionMs: 60_000,
			closeGraceMs: 50,
		},
	};
}

test('the relay dials the exact documented endpoint with header auth and no key in the URL', async () => {
	const server = await startFakeScribeServer();
	openServers.push(server);
	const handle = await connectScribeSession({
		config: testConfig({ baseWsUrl: server.url }),
		language: 'ja',
		epoch: 'ep_relay',
		onEvent: () => {},
	});
	await handle.stop();
	assert.equal(server.handshakes.length, 1);
	const handshake = server.handshakes[0];
	const parsed = new URL(`http://loopback${handshake.url}`);
	assert.equal(parsed.pathname, '/v1/speech-to-text/realtime');
	assert.deepEqual(Object.fromEntries(parsed.searchParams.entries()), {
		model_id: 'scribe_v3_live',
		audio_format: 'pcm_16000',
		commit_strategy: 'manual',
		language_code: 'ja',
		enable_logging: 'false',
	});
	// The credential is only in the documented handshake header.
	assert.equal(handshake.headers['xi-api-key'], 'test-server-key');
	assert.equal(handshake.url.includes('test-server-key'), false);
});

test('audio forwarding, manual commit, and the committed round trip work end to end', async () => {
	const server = await startFakeScribeServer({
		onConnection: (client) => {
			client.send(JSON.stringify({
				message_type: 'session_started',
				session_id: 'srv-session-1',
				config: { enable_logging: false, commit_strategy: 'manual' },
			}));
		},
	});
	openServers.push(server);
	const events: ScribeEvent[] = [];
	const handle = await connectScribeSession({
		config: testConfig({ baseWsUrl: server.url }),
		language: 'ja',
		epoch: 'ep_flow',
		onEvent: (event) => {
			events.push(event);
		},
	});
	const providerSide = frameCollector(server.lastClient()!);
	handle.sendAudioChunk(new Uint8Array([1, 2, 3]));
	handle.commitSegment();
	// Give the relay a tick to flush both frames to the provider side.
	await new Promise((resolve) => {
		setTimeout(resolve, 50);
	});
	assert.deepEqual(providerSide.frames[0], {
		message_type: 'input_audio_chunk',
		audio_base_64: Buffer.from([1, 2, 3]).toString('base64'),
		commit: false,
		sample_rate: 16000,
	});
	assert.deepEqual(providerSide.frames[1], {
		message_type: 'input_audio_chunk',
		audio_base_64: '',
		commit: true,
		sample_rate: 16000,
	});
	// The fake provider answers with the documented committed transcript.
	server.lastClient()?.send(JSON.stringify({
		message_type: 'committed_transcript',
		text: 'はい、そうです。',
	}));
	assert.equal(await handle.awaitFinalCommit(1_000), true);
	const commits = events.filter((event) => event.kind === 'commit');
	assert.equal(commits.length, 1);
	assert.ok(commits[0].kind === 'commit');
	assert.equal(commits[0].text, 'はい、そうです。');
	assert.equal(commits[0].eventKey, '1');
	await handle.stop();
});

test('provider error frames surface as normalized closed events without provider text', async () => {
	const server = await startFakeScribeServer({
		onConnection: (client) => {
			client.send(JSON.stringify({
				message_type: 'session_started',
				session_id: 'srv-session-2',
				config: { enable_logging: false },
			}));
		},
	});
	openServers.push(server);
	const events: ScribeEvent[] = [];
	const handle = await connectScribeSession({
		config: testConfig({ baseWsUrl: server.url }),
		language: 'en',
		epoch: 'ep_close',
		onEvent: (event) => {
			events.push(event);
		},
	});
	server.lastClient()?.send(JSON.stringify({
		message_type: 'insufficient_audio_activity',
		error: 'SECRET-PROVIDER-DETAIL',
	}));
	const closeInfo = await handle.done;
	assert.equal(closeInfo.reason, 'provider_error');
	assert.equal(closeInfo.providerCode, 'insufficient_audio_activity');
	assert.equal(JSON.stringify(events).includes('SECRET-PROVIDER-DETAIL'), false);
});

test('a zero-retention warning surfaces as a fixed notice without closing', async () => {
	const server = await startFakeScribeServer({
		onConnection: (client) => {
			client.send(JSON.stringify({
				message_type: 'session_started',
				session_id: 'srv-session-4',
				config: { enable_logging: true },
			}));
			client.send(JSON.stringify({ message_type: 'warning', warning: 'SECRET-WARNING' }));
		},
	});
	openServers.push(server);
	const notices: string[] = [];
	const handle = await connectScribeSession({
		config: testConfig({ baseWsUrl: server.url }),
		language: 'ja',
		epoch: 'ep_warn',
		onEvent: () => {},
		onNotice: (notice) => {
			notices.push(notice.code);
		},
	});
	assert.deepEqual(notices, ['retention_zero_not_applied', 'retention_zero_not_applied']);
	assert.equal(handle.closed, false);
	await handle.stop();
});

test('a redirecting handshake fails closed instead of being followed', async () => {
	const server = await startFakeScribeServer({ mode: 'redirect' });
	openServers.push(server);
	await assert.rejects(
		connectScribeSession({
			config: testConfig({ baseWsUrl: server.url, ...shortTimeouts() }),
			language: 'ja',
			epoch: 'ep_redirect',
			onEvent: () => {},
		}),
		(error: unknown) => error instanceof StageError && error.code === 'provider_failed',
	);
});

test('a server that never confirms the start is bounded by the open timeout', async () => {
	const server = await startFakeScribeServer({ mode: 'hang' });
	openServers.push(server);
	await assert.rejects(
		connectScribeSession({
			config: testConfig({ baseWsUrl: server.url, ...shortTimeouts() }),
			language: 'ja',
			epoch: 'ep_hang',
			onEvent: () => {},
		}),
		(error: unknown) => error instanceof StageError && error.code === 'provider_failed',
	);
});

test('binary provider frames are ignored', async () => {
	const server = await startFakeScribeServer({
		onConnection: (client) => {
			client.send(JSON.stringify({
				message_type: 'session_started',
				session_id: 'srv-session-3',
				config: { enable_logging: false },
			}));
			client.send(Buffer.from([0, 1, 2, 3]));
		},
	});
	openServers.push(server);
	const events: ScribeEvent[] = [];
	const handle = await connectScribeSession({
		config: testConfig({ baseWsUrl: server.url }),
		language: 'ja',
		epoch: 'ep_binary',
		onEvent: (event) => {
			events.push(event);
		},
	});
	handle.sendAudioChunk(new Uint8Array(8));
	await handle.stop();
	assert.equal(events.some((event) => event.kind === 'commit'), false);
});
