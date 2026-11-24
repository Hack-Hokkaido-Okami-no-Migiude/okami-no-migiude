// Unit tests for the Scribe v3 Live relay adapter with an in-process socket
// double and a manual clock: event normalization (committed events and turn
// finals only), the manual-commit wire shape, redacted failures, and the
// bounded connection lifecycle (idle, session cap, stop, abort, finalize
// wait). No network access.
import { type ScribeEvent, type ScribeHandle, connectScribeSession } from '../../server/voice/scribe';
import { FakeClock } from './helpers/fake-clock';
import { FakeSocket } from './helpers/fake-socket';
import { StageError } from '../../shared/p0/stages';
import { VoiceError } from '../../server/voice/errors';
import assert from 'node:assert/strict';
import test from 'node:test';
import { testConfig } from './helpers/test-config';

type Harness = {
	connect: Promise<ScribeHandle>;
	socket: FakeSocket;
	clock: FakeClock;
	events: ScribeEvent[];
	notices: string[];
};

type SessionOverrides = {
	config?: Partial<Parameters<typeof testConfig>[0]>;
	signal?: AbortSignal;
};

/**
 * Start a session against a silent fake socket: the handshake (open +
 * session_started) is driven immediately so the connect promise resolves.
 */
function startSession(overrides: SessionOverrides = {}): Harness {
	const socket = new FakeSocket();
	const clock = new FakeClock();
	const events: ScribeEvent[] = [];
	const notices: string[] = [];
	const connect = connectScribeSession({
		config: testConfig(overrides.config),
		language: 'ja',
		epoch: 'ep_test_1',
		onEvent: (event) => {
			events.push(event);
		},
		onNotice: (notice) => {
			notices.push(notice.code);
		},
		signal: overrides.signal,
		socketFactory: () => socket,
		clock,
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	return { connect, socket, clock, events, notices };
}

function sessionStartedFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		message_type: 'session_started',
		session_id: 'provider-session-1',
		config: {
			model_id: 'scribe_v3_live',
			audio_format: 'pcm_16000',
			language_code: 'ja',
			commit_strategy: 'manual',
			enable_logging: false,
			...overrides,
		},
	};
}

test('connect requires the provider start confirmation before the handle exists', async () => {
	const socket = new FakeSocket();
	const clock = new FakeClock();
	const connecting = connectScribeSession({
		config: testConfig({ timeouts: { socketOpenMs: 300, ttsMs: 1_000, finalizeWaitMs: 100, idleAudioMs: 100, maxSessionMs: 60_000, closeGraceMs: 50 } }),
		language: 'ja',
		epoch: 'ep_open_timeout',
		onEvent: () => {},
		socketFactory: () => socket,
		clock,
	});
	const rejection = assert.rejects(connecting, (error: unknown) =>
		error instanceof StageError && error.code === 'provider_failed');
	clock.advance(400);
	await rejection;
});

test('connect rejects when the socket errors before the start confirmation', async () => {
	const socket = new FakeSocket();
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'en',
		epoch: 'ep_err',
		onEvent: () => {},
		socketFactory: () => socket,
		clock: new FakeClock(),
	});
	const rejection = assert.rejects(connecting, StageError);
	socket.serverError();
	await rejection;
});

test('the dialed socket URL is the fixed official endpoint with exact server-chosen parameters', async () => {
	const seen: Array<{ url: string; headers: Record<string, string> }> = [];
	const socket = new FakeSocket();
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'ja',
		epoch: 'ep_url',
		onEvent: () => {},
		socketFactory: (url, headers) => {
			seen.push({ url, headers });
			return socket;
		},
		clock: new FakeClock(),
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	const handle = await connecting;
	await handle.stop();
	assert.equal(seen.length, 1);
	assert.equal(seen[0].url, 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
		+ '?model_id=scribe_v3_live&audio_format=pcm_16000&commit_strategy=manual'
		+ '&language_code=ja&enable_logging=false');
	// The key rides the handshake header, never the URL.
	assert.deepEqual(seen[0].headers, { 'xi-api-key': 'test-server-key' });
	assert.equal(seen[0].url.includes('test-server-key'), false);
});

test('partials are display-only and commits are sequential turn finals', async () => {
	const session = startSession();
	const handle = await session.connect;
	const { socket, events } = session;
	socket.serverJson({ message_type: 'partial_transcript', text: 'こんにちは' });
	socket.serverJson({ message_type: 'partial_transcript', text: '' });
	socket.serverJson({
		message_type: 'partial_transcript',
		text: 'こんにちは、ご予約',
		turn_probability: 0.97,
	});
	socket.serverJson({ message_type: 'committed_transcript', text: 'こんにちは、ご予約ですね。' });
	socket.serverJson({ message_type: 'committed_transcript', text: '来月の予約です。' });
	const commits = events.filter((event) => event.kind === 'commit');
	assert.equal(commits.length, 2);
	const [first, second] = commits;
	if (first.kind !== 'commit' || second.kind !== 'commit') {
		assert.fail('expected commit events');
	}
	assert.equal(first.eventKey, '1');
	assert.equal(second.eventKey, '2');
	assert.equal(first.text, 'こんにちは、ご予約ですね。');
	assert.equal(first.startMs, null);
	assert.equal(first.endMs, null);
	// turn_probability and keepalive partials never become events.
	assert.equal(handle.closed, false);
});

test('unknown, legacy-final, and diarization frames are ignored and never emitted', async () => {
	const session = startSession();
	await session.connect;
	const { socket, events } = session;
	socket.serverJson({ message_type: 'final_transcript', text: 'should not appear' });
	socket.serverJson({ message_type: 'diarized_transcript', text: 'nope', words: [] });
	socket.serverJson({ message_type: 'brand_new_future_event', text: 'nope' });
	socket.serverJson('not json at all');
	socket.serverJson({ message_type: 'committed_transcript', text: '本命のみ' });
	const commitOnly = events.filter((event) => event.kind === 'commit');
	assert.equal(commitOnly.length, 1);
	if (commitOnly[0].kind !== 'commit') {
		assert.fail('expected a commit event');
	}
	assert.equal(commitOnly[0].text, '本命のみ');
});

test('provider error frames close the epoch with a fixed code and no provider text', async () => {
	const session = startSession();
	const handle = await session.connect;
	const { socket, events } = session;
	socket.serverJson({
		message_type: 'session_time_limit_exceeded',
		error: 'SECRET-PROVIDER-BODY-you-were-rated',
	});
	const closeInfo = await handle.done;
	assert.equal(closeInfo.reason, 'provider_error');
	assert.equal(closeInfo.providerCode, 'session_time_limit_exceeded');
	const providerErrorClose = events.find(
		(event): event is Extract<ScribeEvent, { kind: 'closed' }> => event.kind === 'closed',
	);
	if (!providerErrorClose || providerErrorClose.kind !== 'closed') {
		assert.fail('expected a closed event');
	}
	assert.equal(providerErrorClose.reason, 'provider_error'); // The untrusted provider string must not leak into any surfaced structure.
	assert.equal(JSON.stringify(events).includes('SECRET-PROVIDER-BODY'), false);
	assert.equal(handle.closed, true);
});

test('frames arriving after close are discarded', async () => {
	const session = startSession();
	const handle = await session.connect;
	const { socket, events } = session;
	handle.stop();
	socket.serverJson({ message_type: 'committed_transcript', text: 'too late' });
	socket.serverJson({ message_type: 'partial_transcript', text: 'too late' });
	assert.deepEqual(events.filter((event) => event.kind === 'commit'), []);
	assert.equal(handle.closed, true);
});

test('stop and abort are idempotent closes with distinct reasons', async () => {
	const stopped = startSession();
	const stoppedHandle = await stopped.connect;
	stoppedHandle.stop();
	stoppedHandle.stop();
	const first = await stoppedHandle.done;
	assert.equal(first.reason, 'stopped');
	assert.deepEqual(stopped.socket.closeCalls, [{ code: 1000, reason: 'shima epoch ended' }]);

	const aborted = startSession();
	const abortedHandle = await aborted.connect;
	abortedHandle.abort();
	const second = await abortedHandle.done;
	assert.equal(second.reason, 'aborted');
});

test('idle with nothing forwarded closes below the provider limit', async () => {
	const socket = new FakeSocket();
	const clock = new FakeClock();
	const events: ScribeEvent[] = [];
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'ja',
		epoch: 'ep_idle',
		onEvent: (event) => {
			events.push(event);
		},
		socketFactory: () => socket,
		clock,
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	const handle = await connecting;
	clock.advance(11_999);
	assert.equal(handle.closed, false);
	clock.advance(1);
	const closeInfo = await handle.done;
	assert.equal(closeInfo.reason, 'idle_timeout');
	assert.equal(
		events.some((event) => event.kind === 'closed' && event.reason === 'idle_timeout'),
		true,
	);
});

test('forwarding audio resets the idle bound; the session cap still closes', async () => {
	const socket = new FakeSocket();
	const clock = new FakeClock();
	const connecting = connectScribeSession({
		config: testConfig({
			timeouts: { socketOpenMs: 300, ttsMs: 1_000, finalizeWaitMs: 100, idleAudioMs: 12_000, maxSessionMs: 60_000, closeGraceMs: 50 },
		}),
		language: 'ja',
		epoch: 'ep_cap',
		onEvent: () => {},
		socketFactory: () => socket,
		clock,
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	const handle = await connecting;
	// Keep forwarding just under the idle bound until the cap fires.
	for (let elapsed = 0; elapsed < 60_000 && !handle.closed; elapsed += 11_000) {
		handle.sendAudioChunk(new Uint8Array(16));
		clock.advance(11_000);
	}
	const closeInfo = await handle.done;
	assert.equal(closeInfo.reason, 'session_cap');
});

test('audio chunks are forwarded as documented input_audio_chunk frames', async () => {
	const session = startSession();
	const handle = await session.connect;
	const { socket } = session;
	const pcm = new Uint8Array([1, 2, 3, 4]);
	handle.sendAudioChunk(pcm);
	handle.commitSegment();
	handle.sendAudioChunk(new Uint8Array([9]), { commit: true });
	assert.equal(socket.sentTexts.length, 3);
	assert.deepEqual(JSON.parse(socket.sentTexts[0]), {
		message_type: 'input_audio_chunk',
		audio_base_64: Buffer.from([1, 2, 3, 4]).toString('base64'),
		commit: false,
		sample_rate: 16000,
	});
	// commitSegment mirrors the official SDK: empty audio, commit=true.
	assert.deepEqual(JSON.parse(socket.sentTexts[1]), {
		message_type: 'input_audio_chunk',
		audio_base_64: '',
		commit: true,
		sample_rate: 16000,
	});
	assert.deepEqual(JSON.parse(socket.sentTexts[2]).commit, true);
});

test('oversized chunks and sends on an ended epoch fail with typed errors', async () => {
	const session = startSession({
		config: { caps: { maxAudioChunkBytes: 4, maxInboundFrameChars: 1000, maxTtsTextChars: 100, maxTtsAudioBytes: 100 } },
	});
	const handle = await session.connect;
	assert.throws(
		() => handle.sendAudioChunk(new Uint8Array(5)),
		(error: unknown) => error instanceof VoiceError && error.code === 'chunk_too_large',
	);
	handle.stop();
	assert.throws(
		() => handle.sendAudioChunk(new Uint8Array(1)),
		(error: unknown) => error instanceof VoiceError && error.code === 'epoch_not_active',
	);
	assert.throws(
		() => handle.commitSegment(),
		(error: unknown) => error instanceof VoiceError && error.code === 'epoch_not_active',
	);
});

test('awaitFinalCommit resolves on the next commit and times out otherwise', async () => {
	const socket = new FakeSocket();
	const clock = new FakeClock();
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'ja',
		epoch: 'ep_final',
		onEvent: () => {},
		socketFactory: () => socket,
		clock,
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	const handle = await connecting;
	const waiting = handle.awaitFinalCommit(5_000);
	// The next committed segment settles the waiter.
	socket.serverJson({ message_type: 'committed_transcript', text: 'はい' });
	assert.equal(await waiting, true);

	const waitingTimeout = handle.awaitFinalCommit(5_000);
	clock.advance(5_000);
	assert.equal(await waitingTimeout, false);

	// The epoch stays open after a finalize timeout (manual text recovery).
	assert.equal(handle.closed, false);
	// And the auto-commit the provider may still emit becomes a normal commit.
	socket.serverJson({ message_type: 'committed_transcript', text: '自動コミット' });
	handle.stop();
});

test('an external abort signal closes the epoch', async () => {
	const controller = new AbortController();
	const socket = new FakeSocket();
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'ja',
		epoch: 'ep_abort',
		onEvent: () => {},
		signal: controller.signal,
		socketFactory: () => socket,
		clock: new FakeClock(),
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame());
	const handle = await connecting;
	controller.abort();
	const closeInfo = await handle.done;
	assert.equal(closeInfo.reason, 'aborted');
});

test('a zero-retention warning is surfaced as a fixed notice and never closes the epoch', async () => {
	const socket = new FakeSocket();
	const notices: string[] = [];
	const connecting = connectScribeSession({
		config: testConfig(),
		language: 'ja',
		epoch: 'ep_zrm',
		onEvent: () => {},
		onNotice: (notice) => {
			notices.push(notice.code);
		},
		socketFactory: () => socket,
		clock: new FakeClock(),
	});
	socket.serverOpen();
	socket.serverJson(sessionStartedFrame({ enable_logging: true }));
	socket.serverJson({ message_type: 'warning', warning: 'SECRET-WARNING-BODY' });
	const handle = await connecting;
	assert.deepEqual(notices, ['retention_zero_not_applied', 'retention_zero_not_applied']);
	assert.equal(handle.closed, false);
	assert.equal(JSON.stringify(notices).includes('SECRET-WARNING-BODY'), false);
	handle.stop();
});
