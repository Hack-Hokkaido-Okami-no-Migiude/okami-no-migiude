import {
	type VoiceIO,
	type VoiceTurnRequest,
	createVoiceInterview,
} from '../../app/components/shima/voice/-voiceInterview';
import {
	browserVoiceIO,
	encodePcm16,
} from '../../app/components/shima/voice/-browserVoiceIO';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

const path = '/api/clients/client_a/sessions/session_b/shima/interview';

function harness(
	overrides: Partial<VoiceIO> = {},
	commitTurn?: (path: string, request: VoiceTurnRequest) => Promise<void>,
) {
	const requests: { path: string; body: unknown }[] = [];
	const sockets: string[] = [];
	let relay: Parameters<VoiceIO['connect']>[1] | undefined;
	let micRequests = 0;
	let closedSockets = 0;
	let closedMics = 0;
	let micEnabled = false;
	let sendChunk: Parameters<VoiceIO['openMic']>[0] | undefined;
	const sent: (ArrayBuffer | string)[] = [];
	const input = {
		available: true,
		consentComplete: true,
		notice: '参加者向け通知',
		interviewPath: path,
		baseRev: 4,
	};
	const io: VoiceIO = {
		origin: () => 'https://pilot.test',
		async post(path, body) {
			requests.push({ path, body });
			return path.endsWith('/start') ?
					{ rev: 5, epoch: 'a+b' }
				:	{ rev: 6, stopped: true };
		},
		connect(url, handlers) {
			sockets.push(url);
			relay = handlers;
			return {
				send(data) {
					sent.push(data);
				},
				close() {
					closedSockets++;
				},
			};
		},
		async openMic(onChunk) {
			micRequests++;
			sendChunk = onChunk;
			return {
				setEnabled(value) {
					micEnabled = value;
				},
				close() {
					closedMics++;
					micEnabled = false;
				},
			};
		},
		async play() {},
		newId: () => '31313131-3131-4131-8131-313131313131',
		...overrides,
	};
	const client = createVoiceInterview(() => input, io, { commitTurn });
	return {
		client,
		input,
		requests,
		sockets,
		sent,
		get micRequests() {
			return micRequests;
		},
		get closedMics() {
			return closedMics;
		},
		get closedSockets() {
			return closedSockets;
		},
		get micEnabled() {
			return micEnabled;
		},
		chunk: (buffer: ArrayBuffer) => sendChunk?.(buffer),
		receive: (event: object) => relay?.message(JSON.stringify(event)),
	};
}

const tick = async () => {
	await Promise.resolve();
};

test('availability, completed consent, notice and call acknowledgement precede start; ready precedes mic', async () => {
	const h = harness();
	await h.client.start(false);
	h.input.available = false;
	await h.client.start(true);
	h.input.available = true;
	h.input.consentComplete = false;
	await h.client.start(true);
	h.input.consentComplete = true;
	h.input.notice = '';
	await h.client.start(true);
	assert.deepEqual(h.requests, []);
	assert.equal(h.micRequests, 0);

	h.input.notice = '参加者向け通知';
	await h.client.start(true);
	assert.deepEqual(h.requests, [
		{ path: `${path}/start`, body: { baseRev: 4, confirmLiveVoice: true } },
	]);
	assert.deepEqual(h.sockets, [`wss://pilot.test${path}/stream?epoch=a%2Bb`]);
	assert.equal(h.micRequests, 0);
	h.receive({ type: 'partial', text: 'not ready' });
	assert.equal(h.micRequests, 0);
	h.receive({ type: 'ready' });
	h.receive({ type: 'ready' });
	await tick();
	assert.equal(h.micRequests, 1);
	await h.client.stop();
});

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test('stop closes the socket immediately and rejects a mic permission result that arrives late', async () => {
	const pendingMic = deferred<Awaited<ReturnType<VoiceIO['openMic']>>>();
	const pendingStop = deferred<unknown>();
	const requests: object[] = [];
	let micClosed = 0;
	let enabled = false;
	let aborted = false;
	const h = harness({
		async post(path, body) {
			if (path.endsWith('/start')) {
				return { rev: 7, epoch: 'epoch-1' };
			}
			requests.push(body);
			return pendingStop.promise;
		},
		openMic: (_, signal) => {
			signal?.addEventListener('abort', () => {
				aborted = true;
			});
			return pendingMic.promise;
		},
	});

	await h.client.start(true);
	h.receive({ type: 'ready' });
	assert.equal(h.client.state.phase, 'permission');
	const stopping = h.client.stop();
	assert.equal(h.closedSockets, 1);
	assert.equal(aborted, true);
	assert.equal(h.client.state.phase, 'stopping');
	pendingMic.resolve({
		setEnabled: (value) => {
			enabled = value;
		},
		close: () => {
			micClosed++;
		},
	});
	await tick();
	assert.equal(enabled, false);
	assert.equal(micClosed, 1);
	assert.deepEqual(requests, [{ baseRev: 7, epoch: 'epoch-1' }]);
	pendingStop.resolve({ rev: 10, stopped: true });
	await stopping;
	assert.equal(h.client.state.phase, 'idle');
});

test('a start response after stop is closed at the original path without a socket or mic', async () => {
	const startResponse = deferred<unknown>();
	const requests: { path: string; body: object }[] = [];
	const h = harness({
		async post(path, body) {
			requests.push({ path, body });
			return path.endsWith('/start') ?
					startResponse.promise
				:	{ rev: 8, stopped: true };
		},
	});
	const starting = h.client.start(true);
	await h.client.stop();
	h.input.interviewPath = path.replace('session_b', 'session_c');
	startResponse.resolve({ rev: 5, epoch: 'late' });
	await starting;
	assert.deepEqual(requests.at(-1), {
		path: `${path}/stop`,
		body: { baseRev: 5, epoch: 'late' },
	});
	assert.deepEqual(h.sockets, []);
	assert.equal(h.micRequests, 0);
});

test('permission denial triggers authoritative stop and never shares partial text', async () => {
	const h = harness({
		async openMic() {
			throw new Error('private detail');
		},
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	await tick();
	assert.equal(h.requests[1]?.path, `${path}/stop`);
	assert.match(h.client.state.message, /マイク/);
	assert.doesNotMatch(h.client.state.message, /private detail/);
	assert.equal(h.closedSockets, 1);
});

test('failed stop keeps local resources closed and presents a retry for the same epoch', async () => {
	const requests: object[] = [];
	const h = harness({
		async post(path, body) {
			if (path.endsWith('/start')) {
				return { rev: 5, epoch: 'retry' };
			}
			requests.push(body);
			if (requests.length === 1) {
				throw new Error('network');
			}
			return { rev: 8, stopped: true };
		},
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	await tick();
	await h.client.stop();
	assert.equal(h.closedSockets, 1);
	assert.equal(h.closedMics, 1);
	assert.equal(h.client.state.stopUnconfirmed, true);
	await h.client.start(true);
	assert.equal(h.sockets.length, 1);
	await h.client.stop();
	assert.deepEqual(requests, [
		{ baseRev: 5, epoch: 'retry' },
		{ baseRev: 5, epoch: 'retry' },
	]);
	assert.equal(h.client.state.stopUnconfirmed, false);
});

test('each same-origin question plays on its own with capture paused and previous playback aborted', async () => {
	const played: {
		url: string;
		signal: AbortSignal;
		done: ReturnType<typeof deferred<undefined>>;
	}[] = [];
	const h = harness({
		play(url, signal) {
			const done = deferred<undefined>();
			played.push({ url, signal, done });
			return done.promise;
		},
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	await tick();
	assert.equal(h.micEnabled, false);
	const question = (id: string, audioPath: string) =>
		h.receive({
			type: 'question',
			question: { id, text: `質問 ${id}` },
			audioPath,
		});
	const chunk = new ArrayBuffer(2);
	question('q0', 'https://elsewhere.test/private.mp3');
	assert.equal(h.client.state.question?.text, '質問 q0');
	assert.equal(played.length, 0);
	assert.equal(h.micEnabled, true);
	question('q1', `${path}/audio/one`);
	assert.equal(h.micEnabled, false);
	h.chunk(chunk);
	question('q2', `${path}/audio/two`);
	assert.equal(played[0]?.signal.aborted, true);
	assert.equal(played[1]?.url, `https://pilot.test${path}/audio/two`);
	played[0]?.done.resolve(undefined);
	await tick();
	assert.equal(h.micEnabled, false);
	assert.deepEqual(h.sent, [
		JSON.stringify({ type: 'playback', active: true }),
	]);
	played[1]?.done.resolve(undefined);
	await tick();
	assert.equal(h.micEnabled, true);
	h.chunk(chunk);
	assert.deepEqual(h.sent, [
		JSON.stringify({ type: 'playback', active: true }),
		JSON.stringify({ type: 'playback', active: false }),
		chunk,
	]);
	question('q3', `${path}/audio/three`);
	await h.client.stop();
	assert.equal(played[2]?.signal.aborted, true);
	assert.equal(h.micEnabled, false);
});

test('only an explicitly saved correction reaches the parent turn writer', async () => {
	const turns: { path: string; request: VoiceTurnRequest }[] = [];
	const h = harness({}, async (path, request) => {
		turns.push({ path, request });
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	h.receive({
		type: 'question',
		question: { id: 'q', text: 'not evidence' },
	});
	await tick();
	h.receive({ type: 'partial', text: 'also not evidence' });
	assert.deepEqual(turns, []);
	h.client.finish();
	assert.equal(h.closedMics, 1);
	assert.deepEqual(h.sent, [JSON.stringify({ type: 'finish' })]);
	h.receive({ type: 'draft', text: 'unreviewed' });
	assert.equal(h.client.state.draft, 'unreviewed');
	assert.deepEqual(turns, []);
	await h.client.submit(' 確認済みの回答 ');
	assert.deepEqual(turns, [
		{
			path: `${path}/turns`,
			request: {
				baseRev: 5,
				turn: {
					turnId: '31313131-3131-4131-8131-313131313131',
					questionId: 'q',
					text: '確認済みの回答',
				},
			},
		},
	]);
	assert.equal(h.closedSockets, 1);
	assert.equal(h.client.state.draft, '');
});

test('an ambiguous save retries only the originally approved text and stable turn ID', async () => {
	const attempts: VoiceTurnRequest[] = [];
	const h = harness({}, async (_, request) => {
		attempts.push(request);
		if (attempts.length === 1) {
			throw new Error('lost confirmation');
		}
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	h.receive({ type: 'question', question: { id: 'q', text: '質問' } });
	await tick();
	h.client.finish();
	h.receive({ type: 'draft', text: '' });
	await h.client.submit('初回に確認した回答');
	assert.equal(h.client.state.draftLocked, true);
	await h.client.submit('回答の変更');
	assert.equal(attempts.length, 1);
	await h.client.submit('初回に確認した回答');
	assert.equal(attempts.length, 2);
	assert.deepEqual(attempts[1]?.turn, attempts[0]?.turn);
});

test('canceling a draft clears text and stops the epoch without an evidence write', async () => {
	const h = harness({}, async () => {
		assert.fail('unexpected commit');
	});
	await h.client.start(true);
	h.receive({ type: 'ready' });
	h.receive({ type: 'question', question: { id: 'q', text: '質問' } });
	await tick();
	h.client.finish();
	h.receive({ type: 'draft', text: '録音下書き' });
	await h.client.stop();
	assert.equal(h.client.state.draft, '');
	assert.equal(h.closedMics, 1);
	assert.equal(h.closedSockets, 1);
	assert.deepEqual(h.requests[1], {
		path: `${path}/stop`,
		body: { baseRev: 5, epoch: 'a+b' },
	});
});

test('unmount stops local capture immediately and disallows restart or late audio', async () => {
	const h = harness();
	await h.client.start(true);
	h.receive({ type: 'ready' });
	h.receive({ type: 'question', question: { id: 'q', text: '質問' } });
	await tick();
	assert.equal(h.micEnabled, true);
	h.client.dispose();
	assert.equal(h.micEnabled, false);
	assert.equal(h.closedMics, 1);
	assert.equal(h.closedSockets, 1);
	h.chunk(new ArrayBuffer(2));
	h.receive({ type: 'partial', text: 'late' });
	await h.client.stop();
	await h.client.start(true);
	assert.equal(h.client.state.partial, '');
	assert.deepEqual(h.sent, []);
	assert.deepEqual(
		h.requests.map((request) => request.path),
		[`${path}/start`, `${path}/stop`],
	);
});

test('wire PCM uses signed 16-bit little-endian samples with clipping', () => {
	const buffer = encodePcm16(
		new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN]),
	);
	assert.deepEqual(
		[...new Uint8Array(buffer)],
		[0, 128, 0, 128, 0, 192, 0, 0, 0, 64, 255, 127, 255, 127, 0, 0],
	);
});

test('browser adapter releases tracks and the 16 kHz context while resume is pending', async (t: TestContext) => {
	const resuming = deferred<undefined>();
	let contextCloses = 0;
	let trackStops = 0;
	const track = {
		enabled: true,
		stop() {
			trackStops++;
		},
	};
	const stubGlobal = (name: string, value: unknown) => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, value });
		t.after(() => {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor);
			} else {
				Reflect.deleteProperty(globalThis, name);
			}
		});
	};
	stubGlobal('navigator', {
		mediaDevices: {
			async getUserMedia() {
				return { getTracks: () => [track] };
			},
		},
	});
	const node = { connect() {}, disconnect() {} };
	stubGlobal(
		'AudioContext',
		class {
			sampleRate = 16_000;
			destination = node;
			constructor(options: AudioContextOptions) {
				assert.equal(options.sampleRate, this.sampleRate);
			}
			createMediaStreamSource() {
				return node;
			}
			createScriptProcessor(samples: number, input: number) {
				assert.equal(samples, 1024);
				assert.equal(input, 1);
				return { ...node, onaudioprocess: null };
			}
			resume() {
				return resuming.promise;
			}
			async close() {
				contextCloses++;
			}
		},
	);
	const controller = new AbortController();
	const opening = browserVoiceIO(() => undefined).openMic(
		() => assert.fail('capture must not be enabled'),
		controller.signal,
	);
	await tick();
	assert.equal(track.enabled, false);
	controller.abort();
	assert.equal(trackStops, 1);
	assert.equal(contextCloses, 1);
	resuming.resolve(undefined);
	await assert.rejects(opening, { name: 'AbortError' });
	assert.equal(contextCloses, 1);
});
