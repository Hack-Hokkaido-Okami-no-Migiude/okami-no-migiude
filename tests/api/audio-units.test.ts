// Unit tests for the recorded-upload audio modules: provider configuration,
// the recording allowlist with signature validation, Scribe response parsing,
// word-to-draft grouping (Japanese spacing, diarization, timestamps), and the
// provider failure paths through the local stub. No external network access.
import { type AudioStub, startAudioStub } from './helpers/audio-stub';
import {
	DELETE_TIMEOUT_MS,
	audioProviderConfig,
} from '../../server/audio/config';
import {
	MAX_MULTIPART_BYTES,
	MIN_RECORDING_BYTES,
	matchesSignature,
} from '../../server/audio/recordings';
import {
	MAX_RECORDING_BYTES,
	RECORDING_ACCEPT,
	describeRecordingAllowlist,
	recordingExtensionOf,
} from '../../shared/p1/audio';
import {
	cleanupStoredTranscript,
	deleteProviderTranscript,
	parseScribeResponse,
	transcribeRecording,
} from '../../server/audio/provider';
import {
	draftTranscriptFromWords,
	speakerLabelOf,
} from '../../server/audio/draft';
import test, { after, before } from 'node:test';
import type { ScribeWord } from '../../server/audio/provider';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';

const JP_WORDS: ScribeWord[] = [
	{ text: '受付', type: 'word', start: 0, end: 0.4, speaker_id: 'speaker_0' },
	{ text: 'です', type: 'word', start: 0.4, end: 0.8, speaker_id: 'speaker_0' },
	{ text: '、', type: 'word', start: 0.8, end: 0.95, speaker_id: 'speaker_0' },
	{ text: 'ご予約', type: 'word', start: 0.95, end: 1.6, speaker_id: 'speaker_0' },
	{ text: 'ですね', type: 'word', start: 1.6, end: 2.2, speaker_id: 'speaker_0' },
	{ text: '。', type: 'word', start: 2.2, end: 2.4, speaker_id: 'speaker_0' },
	{ text: '(laughter)', type: 'audio_event', start: 2.5, end: 2.8, speaker_id: null },
	{ text: 'はい', type: 'word', start: 2.9, end: 3.3, speaker_id: 'speaker_1' },
	{ text: '、', type: 'word', start: 3.3, end: 3.4, speaker_id: 'speaker_1' },
	{ text: '先月', type: 'word', start: 3.4, end: 3.9, speaker_id: 'speaker_1' },
	{ text: '予約した', type: 'word', start: 3.9, end: 4.6, speaker_id: 'speaker_1' },
	{ text: '佐藤', type: 'word', start: 4.6, end: 5, speaker_id: 'speaker_1' },
	{ text: 'です', type: 'word', start: 5, end: 5.4, speaker_id: 'speaker_1' },
];

const EN_WORDS: ScribeWord[] = [
	{ text: 'Good', type: 'word', start: 0, end: 0.3, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', start: null, end: null, speaker_id: null },
	{ text: 'morning', type: 'word', start: 0.3, end: 0.8, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', start: null, end: null, speaker_id: null },
	{ text: 'everyone', type: 'word', start: 0.8, end: 1.3, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', start: null, end: null, speaker_id: null },
	{ text: 'Morning', type: 'word', start: 1.9, end: 2.3, speaker_id: 'speaker_1' },
	{ text: ' ', type: 'spacing', start: null, end: null, speaker_id: null },
	{ text: 'Yuki', type: 'word', start: 2.3, end: 2.7, speaker_id: 'speaker_1' },
	{ text: ' ', type: 'spacing', start: null, end: null, speaker_id: null },
	{ text: 'here', type: 'word', start: 2.7, end: 3.1, speaker_id: 'speaker_1' },
];

function withEnv(
	values: Record<string, string | undefined>,
	run: () => void,
): void {
	const saved: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(values)) {
		saved[key] = process.env[key];
		if (value === undefined) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
	try {
		run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = value;
			}
		}
	}
}

test('recorded upload requires the server-side ElevenLabs key', () => {
	withEnv({ NUXT_ELEVENLABS_API_KEY: undefined }, () => {
		assert.throws(
			() => audioProviderConfig(),
			(error: unknown) =>
				error instanceof StageError
				&& error.code === 'provider_unconfigured',
		);
	});
	withEnv({ NUXT_ELEVENLABS_API_KEY: '  ' }, () => {
		assert.throws(() => audioProviderConfig(), StageError);
	});
});

test('the provider base URL defaults to the official HTTPS API and accepts loopback test overrides', () => {
	withEnv({ NUXT_ELEVENLABS_API_KEY: 'k', NUXT_ELEVENLABS_BASE_URL: undefined }, () => {
		assert.equal(
			audioProviderConfig().baseUrl,
			'https://api.elevenlabs.io',
		);
		assert.equal(audioProviderConfig().timeoutMs > 30_000, true);
	});
	withEnv(
		{
			NUXT_ELEVENLABS_API_KEY: 'k',
			NUXT_ELEVENLABS_BASE_URL: 'http://127.0.0.1:9378/',
		},
		() => {
			assert.equal(
				audioProviderConfig().baseUrl,
				'http://127.0.0.1:9378',
			);
		},
	);
	withEnv(
		{
			NUXT_ELEVENLABS_API_KEY: 'k',
			NUXT_ELEVENLABS_BASE_URL: 'https://api.example.test',
		},
		() => {
			assert.equal(
				audioProviderConfig().baseUrl,
				'https://api.example.test',
			);
		},
	);
});

test('non-loopback plaintext base URL overrides are rejected', () => {
	withEnv(
		{
			NUXT_ELEVENLABS_API_KEY: 'k',
			NUXT_ELEVENLABS_BASE_URL: 'http://api.example.test',
		},
		() => {
			assert.throws(
				() => audioProviderConfig(),
				(error: unknown) =>
					error instanceof StageError
					&& error.code === 'provider_unconfigured',
			);
		},
	);
	withEnv(
		{
			NUXT_ELEVENLABS_API_KEY: 'k',
			NUXT_ELEVENLABS_BASE_URL: 'not a url',
		},
		() => {
			assert.throws(() => audioProviderConfig(), StageError);
		},
	);
});

test('the deletion timeout is short and independent of transcription', () => {
	assert.equal(DELETE_TIMEOUT_MS <= 15_000, true);
});

test('the audio allowlist is small, documented, and drives the accept list', () => {
	const description = describeRecordingAllowlist();
	for (const format of ['MP3', 'WAV', 'FLAC', 'OGG', 'M4A', 'WebM']) {
		assert.match(description, new RegExp(format));
	}
	assert.deepEqual(
		recordingExtensionOf('Hotel Interview 2026-11-24.M4A'),
		'm4a',
	);
	assert.equal(recordingExtensionOf('notes.txt'), null);
	assert.equal(recordingExtensionOf('no-extension'), null);
	assert.equal(recordingExtensionOf(null), null);
	for (const entry of RECORDING_ACCEPT.split(',')) {
		assert.match(entry, /^\.(mp3|wav|flac|ogg|m4a|webm)$/);
	}
	assert.equal(MAX_RECORDING_BYTES, 10 * 1024 * 1024);
	assert.equal(MAX_MULTIPART_BYTES > MAX_RECORDING_BYTES, true);
});

const SIGNATURE_SAMPLES: Record<string, Buffer> = {
	mp3: Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(32)]),
	wav: Buffer.concat([
		Buffer.from('RIFF', 'latin1'),
		Buffer.alloc(4),
		Buffer.from('WAVE', 'latin1'),
		Buffer.alloc(64),
	]),
	flac: Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.alloc(32)]),
	ogg: Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(32)]),
	m4a: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp', 'latin1'), Buffer.alloc(64)]),
	webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]),
};

test('signature validation accepts declared formats and rejects mismatches', () => {
	for (const [extension, bytes] of Object.entries(SIGNATURE_SAMPLES)) {
		assert.equal(
			matchesSignature(extension as 'mp3', bytes),
			true,
			`${extension} sample must match its own signature`,
		);
	}
	// WAV bytes presented as MP3 must not pass.
	assert.equal(matchesSignature('mp3', SIGNATURE_SAMPLES.wav as Buffer), false);
	// A bare MPEG audio frame (0xFF 0xFB) is a valid MP3 without an ID3 tag.
	assert.equal(matchesSignature('mp3', Buffer.from([0xff, 0xfb, 0x90, 0x00])), true);
	// A text file matches nothing.
	assert.equal(matchesSignature('wav', Buffer.from('hello world', 'utf8')), false);
	assert.equal(MIN_RECORDING_BYTES > 0, true);
});

test('parsing validates the documented Scribe response shape', () => {
	const parsed = parseScribeResponse({
		language_code: 'jpn',
		language_probability: 0.98,
		text: 'ignored for rows',
		words: JP_WORDS,
		transcription_id: 'transcription_stub_1',
	});
	assert.equal(parsed.languageCode, 'jpn');
	assert.equal(parsed.transcriptionId, 'transcription_stub_1');
	assert.equal(parsed.words.length, JP_WORDS.length);
	assert.equal(parsed.words[1]?.text, 'です');

	// Shape-valid emptiness passes: the caller decides unusability so the
	// best-effort cleanup can still run (see the transcribe route).
	assert.equal(
		parseScribeResponse({
			language_code: 'jpn',
			language_probability: 0.9,
			text: '',
			words: [],
		}).words.length,
		0,
	);
	assert.throws(
		() => parseScribeResponse({ language_code: 'jpn' }),
		StageError,
	);
	assert.throws(
		() => parseScribeResponse('not an object'),
		StageError,
	);
	assert.equal(
		parseScribeResponse({
			language_code: 'eng',
			language_probability: 0.9,
			text: 'x',
			words: EN_WORDS,
		}).transcriptionId,
		null,
		'a missing transcription id means no provider-side deletion target',
	);
});

test('Japanese words group into speaker turns without inserted spaces', () => {
	const draft = draftTranscriptFromWords(JP_WORDS);
	assert.equal(draft.source, 'audio');
	assert.deepEqual(draft.segments, [
		{
			speaker: 'Speaker 1',
			text: '受付です、ご予約ですね。',
			startMs: 0,
			endMs: 2400,
		},
		{
			speaker: 'Speaker 2',
			text: 'はい、先月予約した佐藤です',
			startMs: 2900,
			endMs: 5400,
		},
	]);
});

test('English rows keep exactly the spacing the provider emitted', () => {
	const draft = draftTranscriptFromWords(EN_WORDS);
	assert.deepEqual(
		draft.segments.map((segment) => [segment.speaker, segment.text, segment.startMs, segment.endMs]),
		[
			['Speaker 1', 'Good morning everyone', 0, 1300],
			['Speaker 2', 'Morning Yuki here', 1900, 3100],
		],
	);
});

test('an unattributed transcription produces one unattributed row', () => {
	const draft = draftTranscriptFromWords(
		EN_WORDS.map((word) => ({ ...word, speaker_id: null })),
	);
	assert.equal(draft.segments.length, 1);
	assert.equal(draft.segments[0]?.speaker, null);
	assert.equal(draft.segments[0]?.text, 'Good morning everyone Morning Yuki here');
	assert.equal(draft.segments[0]?.startMs, 0);
	assert.equal(draft.segments[0]?.endMs, 3100);
});

test('speaker labels stay neutral: numbered provider ids map, others pass through', () => {
	assert.equal(speakerLabelOf('speaker_0'), 'Speaker 1');
	assert.equal(speakerLabelOf('speaker_11'), 'Speaker 12');
	assert.equal(speakerLabelOf('agent'), 'agent');
	assert.equal(speakerLabelOf(null), null);
});

test('untimed words yield null times and impossible ranges are dropped', () => {
	const draft = draftTranscriptFromWords([
		{ text: 'Hello', type: 'word', start: null, end: null, speaker_id: 'speaker_0' },
		{ text: 'there', type: 'word', start: null, end: null, speaker_id: 'speaker_0' },
	]);
	assert.deepEqual(draft.segments, [
		{ speaker: 'Speaker 1', text: 'Hellothere', startMs: null, endMs: null },
	]);
	const rounded = draftTranscriptFromWords([
		{ text: 'a', type: 'word', start: 0.0005, end: 0.0009, speaker_id: null },
		{ text: 'b', type: 'word', start: 1.2346, end: -2, speaker_id: null },
	]);
	assert.equal(rounded.segments[0]?.startMs, 1);
	assert.equal(rounded.segments[0]?.endMs, 1, 'negative times are ignored');
});

test('blank word entries never create blank rows', () => {
	const draft = draftTranscriptFromWords([
		{ text: '', type: 'word', start: 0, end: 1, speaker_id: 'speaker_0' },
		{ text: '実', type: 'word', start: 1, end: 2, speaker_id: 'speaker_0' },
	]);
	assert.deepEqual(draft.segments, [
		{ speaker: 'Speaker 1', text: '実', startMs: 1000, endMs: 2000 },
	]);
});

let stub: AudioStub;

before(async () => {
	stub = await startAudioStub();
});

after(async () => {
	await stub.close();
});

test('provider calls use the injected loopback stub with a short timeout', async () => {
	stub.setMode('slow');
	try {
		let failure: unknown = null;
		try {
			await transcribeRecording(
				{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 400 },
				{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
			);
		} catch (error) {
			failure = error;
		}
		assert.equal(stub.uploads.length, 1, 'exactly one upload attempt, no retries');
		assert.equal(stub.uploads[0]?.filename, 'recording.wav');
		assert.equal(stub.uploads[0]?.fields.model_id, 'scribe_v3');
		assert.equal(stub.uploads[0]?.fields.diarize, 'true');
		assert.equal(stub.uploads[0]?.fields.timestamps_granularity, 'word');
		assert.equal(failure instanceof StageError, true);
		assert.equal((failure as StageError).code, 'provider_failed');
		assert.match((failure as StageError).message, /timed out/);
	} finally {
		stub.setMode('ok');
	}
});

test('provider errors are redacted to fixed phrases', async () => {
	stub.setMode('server-error');
	await assert.rejects(
		transcribeRecording(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 2000 },
			{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
		),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& !error.message.includes('secret-provider-detail'),
	);
	stub.setMode('malformed');
	await assert.rejects(
		transcribeRecording(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 2000 },
			{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
		),
		(error: unknown) =>
			error instanceof StageError && error.code === 'invalid_model_output',
	);
	stub.setMode('empty');
	const empty = await transcribeRecording(
		{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 2000 },
		{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
	);
	assert.equal(
		empty.words.length,
		0,
		'shape-valid emptiness is decided by the caller after cleanup',
	);
	stub.setMode('ok');
});

test('provider-side deletion is best effort and honest about outcomes', async () => {
	assert.equal(
		await deleteProviderTranscript(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: DELETE_TIMEOUT_MS },
			'transcription_stub_1',
		),
		'deleted',
	);
	assert.deepEqual(stub.deletions, ['transcription_stub_1']);
	assert.equal(
		await deleteProviderTranscript(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: DELETE_TIMEOUT_MS },
			'never-stored-id',
		),
		'unavailable',
	);
	assert.equal(
		await deleteProviderTranscript(
			{ baseUrl: 'http://127.0.0.1:1', apiKey: 'stub-key', timeoutMs: DELETE_TIMEOUT_MS },
			'transcription_stub_1',
		),
		'failed',
	);
});

test('cleanup without a reported transcription id is `unavailable` by definition', async () => {
	assert.equal(
		await cleanupStoredTranscript(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: DELETE_TIMEOUT_MS },
			null,
		),
		'unavailable',
	);
	assert.equal(stub.deletions.at(-1), 'never-stored-id', 'no delete was attempted');
});

test('a response past the size limit is rejected while streaming, even without a declared length', async () => {
	stub.setMode('oversized');
	await assert.rejects(
		transcribeRecording(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 2000 },
			{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
		),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& /size limit/u.test(error.message),
	);
	stub.setMode('ok');
});

test('redirect responses are rejected instead of followed for POST and DELETE', async () => {
	stub.setMode('redirect');
	const uploadsBefore = stub.uploads.length;
	await assert.rejects(
		transcribeRecording(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: 2000 },
			{ bytes: Buffer.alloc(64, 1), extension: 'wav' },
		),
		(error: unknown) =>
			error instanceof StageError && error.code === 'provider_failed',
	);
	assert.equal(
		stub.uploads.length,
		uploadsBefore + 1,
		'the upload redirect was not followed with a second request',
	);
	const deletionsBefore = stub.deletions.length;
	assert.equal(
		await deleteProviderTranscript(
			{ baseUrl: stub.url, apiKey: 'stub-key', timeoutMs: DELETE_TIMEOUT_MS },
			'transcription_stub_1',
		),
		'failed',
	);
	assert.equal(
		stub.deletions.length,
		deletionsBefore + 1,
		'the delete redirect was not followed with a second request',
	);
	stub.setMode('ok');
});
