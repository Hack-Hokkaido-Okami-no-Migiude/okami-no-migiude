// Unit tests for the question-speech seam with an injected fetch: exact
// request shape on the fixed official host, server-chosen-question guard,
// bounded responses, redirect refusal, redacted failures, and the stub
// injection path. No external network access.
import {
	LIVE_VOICE_DISCLOSURE,
	assertApprovedQuestion,
	speakApprovedQuestion,
} from '../../server/voice/tts';
import { StageError } from '../../shared/p0/stages';
import { VoiceError } from '../../server/voice/errors';
import assert from 'node:assert/strict';
import test from 'node:test';
import { testConfig } from './helpers/test-config';

type CapturedCall = { url: string; init: RequestInit };

function fetchCapture(response: () => Response): {
	fetchImpl: typeof fetch;
	calls: CapturedCall[];
} {
	const calls: CapturedCall[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return response();
	}) as typeof fetch;
	return { fetchImpl, calls };
}

function audioResponse(): Response {
	return new Response(Buffer.from([1, 2, 3, 4]), {
		status: 200,
		headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
	});
}

const QUESTION = { questionId: 'q_hotel_01', language: 'ja' as const, text: 'お部屋の変更はどのくらいの頻度ですか。' };

test('speech posts exactly the approved question to the fixed official endpoint', async () => {
	const { fetchImpl, calls } = fetchCapture(audioResponse);
	const audio = await speakApprovedQuestion({
		config: testConfig(),
		question: QUESTION,
		fetchImpl,
	});
	assert.deepEqual([...audio.bytes], [1, 2, 3, 4]);
	assert.equal(audio.contentType, 'audio/mpeg');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/ja-voice-id/stream'
		+ '?output_format=mp3_44100_128&enable_logging=false');
	assert.equal(calls[0].init.method, 'POST');
	assert.deepEqual(calls[0].init.headers, {
		'xi-api-key': 'test-server-key',
		'content-type': 'application/json',
	});
	assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
		text: QUESTION.text,
		model_id: 'eleven_flash_v2_5',
		language_code: 'ja',
	});
	// Redirects are refused, never followed.
	assert.equal(calls[0].init.redirect, 'error');
});

test('the English voice id is resolved per language when configured', async () => {
	const { fetchImpl, calls } = fetchCapture(audioResponse);
	await speakApprovedQuestion({
		config: testConfig({ voiceEn: 'en-voice-id' }),
		question: { questionId: 'q_intro_02', language: 'en', text: 'How often do you change rooms?' },
		fetchImpl,
	});
	assert.equal(calls[0].url.includes('/v1/text-to-speech/en-voice-id/stream'), true);
	assert.deepEqual(JSON.parse(String(calls[0].init.body)).language_code, 'en');
});

test('speech fails closed when the voice id for the language is not configured', async () => {
	const { fetchImpl, calls } = fetchCapture(audioResponse);
	await assert.rejects(
		speakApprovedQuestion({
			config: testConfig(),
			question: { questionId: 'q_intro_02', language: 'en', text: 'Hello' },
			fetchImpl,
		}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_unconfigured'
			&& /NUXT_ELEVENLABS_VOICE_ID_EN/.test(error.message),
	);
	assert.equal(calls.length, 0);
});

test('only server-approved questions may be spoken; free text is rejected', () => {
	assert.throws(
		() => assertApprovedQuestion({ questionId: '', language: 'ja', text: 'x' }),
		(error: unknown) => error instanceof VoiceError && error.code === 'question_invalid',
	);
	assert.throws(
		() => assertApprovedQuestion({ questionId: 'q x', language: 'ja', text: 'x' }),
		(error: unknown) => error instanceof VoiceError && error.code === 'question_invalid',
	);
	assert.throws(
		() => assertApprovedQuestion({ questionId: 'q_ok', language: 'ja', text: '   ' }),
		(error: unknown) => error instanceof VoiceError && error.code === 'question_invalid',
	);
	const longText = 'あ'.repeat(501);
	assert.throws(
		() => assertApprovedQuestion({ questionId: 'q_ok', language: 'ja', text: longText }),
		(error: unknown) => error instanceof VoiceError && error.code === 'question_invalid',
	);
});

test('provider failures are fixed phrases without the question text or response body', async () => {
	const { fetchImpl } = fetchCapture(() => new Response('SECRET-BODY', { status: 500 }));
	await assert.rejects(
		speakApprovedQuestion({ config: testConfig(), question: QUESTION, fetchImpl }),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& error.message === 'Provider speech failed with status 500.'
			&& !error.message.includes(QUESTION.text)
			&& !error.message.includes('SECRET-BODY'),
	);
});

test('non-audio responses are rejected as unusable model output', async () => {
	const { fetchImpl } = fetchCapture(
		() => new Response('{"detail":"not audio"}', {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}),
	);
	await assert.rejects(
		speakApprovedQuestion({ config: testConfig(), question: QUESTION, fetchImpl }),
		(error: unknown) =>
			error instanceof StageError && error.code === 'invalid_model_output',
	);
});

test('oversized speech responses are cut off at the cap', async () => {
	const big = Buffer.alloc(64, 7);
	const { fetchImpl } = fetchCapture(
		() => new Response(big, {
			status: 200,
			headers: { 'content-type': 'audio/mpeg' },
		}),
	);
	await assert.rejects(
		speakApprovedQuestion({
			config: testConfig({ caps: { maxAudioChunkBytes: 1024, maxInboundFrameChars: 1000, maxTtsTextChars: 100, maxTtsAudioBytes: 16 } }),
			question: QUESTION,
			fetchImpl,
		}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& error.message === 'Provider speech exceeded the size limit.',
	);
});

test('network and timeout failures are fixed phrases', async () => {
	const failing = (async () => {
		throw new Error('connect ECONNREFUSED 127.0.0.1');
	}) as typeof fetch;
	await assert.rejects(
		speakApprovedQuestion({ config: testConfig(), question: QUESTION, fetchImpl: failing }),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& error.message === 'Provider speech request failed.',
	);
	// An injected fetch that honors the abort signal simulates the timeout.
	const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		await new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => {
				const error = new Error('This operation was aborted');
				error.name = 'TimeoutError';
				reject(error);
			}, { once: true });
		});
		throw new Error('unreachable');
	}) as typeof fetch;
	await assert.rejects(
		speakApprovedQuestion({
			config: testConfig({ timeouts: { socketOpenMs: 100, ttsMs: 20, finalizeWaitMs: 10, idleAudioMs: 10, maxSessionMs: 60_000, closeGraceMs: 10 } }),
			question: QUESTION,
			fetchImpl: hanging,
		}),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'provider_failed'
			&& error.message === 'Provider speech request timed out.',
	);
});

test('the retention disclosure is fixed and honest about zero retention', () => {
	assert.match(LIVE_VOICE_DISCLOSURE, /ElevenLabs/);
	assert.match(LIVE_VOICE_DISCLOSURE, /zero retention/i);
	assert.match(LIVE_VOICE_DISCLOSURE, /United States/);
	assert.match(LIVE_VOICE_DISCLOSURE, /no raw audio/);
	assert.match(LIVE_VOICE_DISCLOSURE, /type/);
});
