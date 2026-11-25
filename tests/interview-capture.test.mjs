// Unit tests for the microphone capture lifecycle (local-only, ephemeral
// MediaRecorder) and the local speech synthesis helper. All browser APIs are
// injected fakes — no real devices, no network.
import assert from 'node:assert/strict';
import { createInterviewCapture } from '../app/composables/useInterviewCapture.ts';
import { createInterviewSpeech } from '../app/composables/useInterviewSpeech.ts';
import test from 'node:test';

class FakeTrack {
	constructor() {
		this.stopped = false;
		this.listeners = new Map();
	}
	addEventListener(type, handler) {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}
	emit(type) {
		for (const handler of this.listeners.get(type) ?? []) {
			handler();
		}
	}
	stop() {
		this.stopped = true;
	}
}

class FakeStream {
	constructor() {
		this.tracks = [new FakeTrack()];
	}
	getTracks() {
		return this.tracks;
	}
}

class FakeRecorder {
	constructor(stream) {
		this.stream = stream;
		this.state = 'inactive';
		this.ondataavailable = null;
		this.onstop = null;
		this.onerror = null;
		this.started = 0;
		FakeRecorder.instances.push(this);
	}
	start() {
		this.started += 1;
		this.state = 'recording';
	}
	stop() {
		this.state = 'inactive';
		if (this.ondataavailable) {
			this.ondataavailable({ data: new Blob(['chunk']) });
		}
		if (this.onstop) {
			this.onstop();
		}
	}
}

FakeRecorder.instances = [];

function fakeUrls() {
	const created = [];
	const revoked = [];
	return {
		createObjectUrl: (blob) => {
			created.push(blob);
			return `blob:fake-${created.length}`;
		},
		revokeObjectUrl: (url) => {
			revoked.push(url);
		},
		created,
		revoked,
	};
}

function buildCapture(overrides = {}) {
	const streams = [];
	const urls = overrides.urls ?? fakeUrls();
	const cleanups = [];
	const getUserMedia =
		overrides.getUserMedia
		?? (async () => {
			const stream = new FakeStream();
			streams.push(stream);
			return stream;
		});
	const capture = createInterviewCapture({
		getUserMedia,
		MediaRecorderCtor: FakeRecorder,
		createObjectUrl: urls.createObjectUrl,
		revokeObjectUrl: urls.revokeObjectUrl,
		registerCleanup: (fn) => {
			cleanups.push(fn);
		},
		...overrides.deps,
	});
	return { capture, streams, urls, cleanups };
}

test('capture is unsupported without injected browser APIs', async () => {
	const { capture } = buildCapture({ deps: { getUserMedia: undefined } });
	assert.equal(capture.supported.value, false);
	assert.equal(capture.phase.value, 'unsupported');
	assert.equal(await capture.start(DEADLINE_FUTURE()), false);
});

const DEADLINE_FUTURE = () => Date.now() + 3_600_000;
const DEADLINE_PAST = () => Date.now() - 1;

test('start records locally; stop yields an ephemeral review URL', async () => {
	const { capture, streams, urls } = buildCapture();
	assert.equal(await capture.start(DEADLINE_FUTURE()), true);
	assert.equal(capture.phase.value, 'recording');
	assert.equal(streams.length, 1);
	assert.equal(FakeRecorder.instances.length, 1);

	capture.stop('user');
	assert.equal(capture.phase.value, 'idle');
	assert.ok(streams[0].tracks[0].stopped, 'tracks released on stop');
	assert.equal(capture.reviewUrl.value, 'blob:fake-1');
	assert.deepEqual(urls.revoked, []);

	// Starting again clears the previous review.
	assert.equal(await capture.start(DEADLINE_FUTURE()), true);
	assert.equal(capture.reviewUrl.value, null);
	assert.deepEqual(urls.revoked, ['blob:fake-1']);
	capture.stop('user');
});

test('permission denial and missing devices surface typed failures', async () => {
	const denied = buildCapture({
		getUserMedia: async () => {
			const error = new Error('denied');
			error.name = 'NotAllowedError';
			throw error;
		},
	});
	assert.equal(await denied.capture.start(DEADLINE_FUTURE()), false);
	assert.equal(denied.capture.phase.value, 'error');
	assert.equal(denied.capture.failure.value, 'denied');

	const missing = buildCapture({
		getUserMedia: async () => {
			const error = new Error('no device');
			error.name = 'NotFoundError';
			throw error;
		},
	});
	assert.equal(await missing.capture.start(DEADLINE_FUTURE()), false);
	assert.equal(missing.capture.phase.value, 'error');
	assert.equal(missing.capture.failure.value, 'not_found');
});

test('start refuses when already recording or after the hard cut', async () => {
	const { capture, streams } = buildCapture();
	assert.equal(await capture.start(DEADLINE_FUTURE()), true);
	assert.equal(await capture.start(DEADLINE_FUTURE()), false);
	assert.equal(streams.length, 1, 'no second getUserMedia call');

	capture.stop('user');
	assert.equal(await capture.start(DEADLINE_PAST()), false);
	assert.equal(capture.phase.value, 'idle', 'deadline refusal keeps idle');
	assert.equal(streams.length, 1);
});

test('device removal and recorder errors stop capture safely', async () => {
	const ended = buildCapture();
	await ended.capture.start(DEADLINE_FUTURE());
	ended.streams[0].tracks[0].emit('ended');
	assert.equal(ended.capture.phase.value, 'idle');

	const failing = buildCapture();
	await failing.capture.start(DEADLINE_FUTURE());
	const recorder = FakeRecorder.instances.at(-1);
	assert.equal(typeof recorder.onerror, 'function');
	recorder.onerror({ error: new Error('recorder failed') });
	assert.equal(failing.capture.phase.value, 'idle');
});

test('unmount cleanup stops capture and revokes the review URL', async () => {
	const { capture, streams, urls, cleanups } = buildCapture();
	await capture.start(DEADLINE_FUTURE());
	capture.stop('user');
	for (const cleanup of cleanups) {
		cleanup();
	}
	assert.ok(streams[0].tracks[0].stopped);
	assert.deepEqual(urls.revoked, ['blob:fake-1']);
});

function fakeSpeech() {
	const spoken = [];
	const synthesis = {
		speaking: false,
		speak(utterance) {
			spoken.push(utterance);
			this.speaking = true;
		},
		cancel() {
			this.speaking = false;
		},
	};
	class FakeUtterance {
		constructor(text) {
			this.text = text;
			this.lang = '';
			this.rate = 1;
			this.onend = null;
		}
	}
	return { synthesis, FakeUtterance, spoken };
}

test('speech speaks locally with the right language tag', () => {
	const { synthesis, FakeUtterance, spoken } = fakeSpeech();
	const cleanups = [];
	const speech = createInterviewSpeech({
		synthesis,
		UtteranceCtor: FakeUtterance,
		registerCleanup: (fn) => {
			cleanups.push(fn);
		},
	});
	assert.equal(speech.supported.value, true);
	assert.equal(speech.speak('こんにちは', 'ja'), true);
	assert.equal(spoken.length, 1);
	assert.equal(spoken[0].lang, 'ja-JP');
	assert.equal(speech.speaking.value, true);

	// The synthetic onend handler resets the speaking state.
	spoken[0].onend();
	assert.equal(speech.speaking.value, false);

	assert.equal(speech.speak('hello', 'en'), true);
	assert.equal(spoken[1].lang, 'en-US');

	speech.cancel();
	assert.equal(speech.speaking.value, false);
	for (const cleanup of cleanups) {
		cleanup();
	}
});

test('speech without synthesis support degrades to visible text only', () => {
	const speech = createInterviewSpeech({});
	assert.equal(speech.supported.value, false);
	assert.equal(speech.speak('こんにちは', 'ja'), false);
	assert.equal(speech.speaking.value, false);
	assert.doesNotThrow(() => speech.cancel());
});

test('speech failures leave the speaking state clean', () => {
	const synthesis = {
		speak() {
			throw new Error('audio busy');
		},
		cancel() {},
	};
	const speech = createInterviewSpeech({
		synthesis,
		UtteranceCtor: class {},
	});
	assert.equal(speech.speak('text', 'ja'), false);
	assert.equal(speech.speaking.value, false);
});
