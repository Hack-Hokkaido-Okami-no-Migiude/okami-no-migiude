// Configuration tests: fail-closed behavior, the official host default, the
// loopback-only override rule, per-language voice ids, and bound sanity (the
// relay must close before the provider's 15-second no-message limit).
import {
	IDLE_AUDIO_TIMEOUT_MS,
	MAX_AUDIO_CHUNK_BYTES,
	MAX_TTS_AUDIO_BYTES,
	SOCKET_OPEN_TIMEOUT_MS,
	TTS_TIMEOUT_MS,
	voiceIdForLanguage,
	voiceProviderConfig,
} from '../../server/voice/config';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from './helpers/with-env';

test('live voice fails closed without the server-side key', () => {
	withEnv({ NUXT_ELEVENLABS_API_KEY: undefined }, () => {
		assert.throws(
			() => voiceProviderConfig(),
			(error: unknown) =>
				error instanceof StageError && error.code === 'provider_unconfigured',
		);
	});
	withEnv({ NUXT_ELEVENLABS_API_KEY: '   ' }, () => {
		assert.throws(() => voiceProviderConfig(), StageError);
	});
});

test('the base URL defaults to the official origin and accepts loopback overrides only', () => {
	withEnv({ NUXT_ELEVENLABS_API_KEY: 'k', NUXT_ELEVENLABS_BASE_URL: undefined }, () => {
		const config = voiceProviderConfig();
		assert.equal(config.baseHttpsUrl, 'https://api.elevenlabs.io');
		assert.equal(config.baseWsUrl, 'wss://api.elevenlabs.io');
	});
	withEnv({ NUXT_ELEVENLABS_API_KEY: 'k', NUXT_ELEVENLABS_BASE_URL: 'http://127.0.0.1:9378/' }, () => {
		const config = voiceProviderConfig();
		assert.equal(config.baseHttpsUrl, 'http://127.0.0.1:9378');
		assert.equal(config.baseWsUrl, 'ws://127.0.0.1:9378');
	});
	for (const invalid of ['ftp://example.com', 'https://evil.example', 'http://10.0.0.1:9378', 'not a url']) {
		withEnv({ NUXT_ELEVENLABS_API_KEY: 'k', NUXT_ELEVENLABS_BASE_URL: invalid }, () => {
			assert.throws(() => voiceProviderConfig(), StageError);
		});
	}
});

test('voice ids are resolved per language and speech fails closed without one', () => {
	withEnv(
		{
			NUXT_ELEVENLABS_API_KEY: 'k',
			NUXT_ELEVENLABS_VOICE_ID_JA: 'ja-voice',
			NUXT_ELEVENLABS_VOICE_ID_EN: undefined,
		},
		() => {
			const config = voiceProviderConfig();
			assert.equal(voiceIdForLanguage(config, 'ja'), 'ja-voice');
			assert.equal(config.voiceEn, null);
			assert.throws(
				() => voiceIdForLanguage(config, 'en'),
				(error: unknown) =>
					error instanceof StageError && error.code === 'provider_unconfigured',
			);
		},
	);
});

test('the bounds keep the relay inside the provider limits', () => {
	// The provider closes the socket 15 seconds after the last client message.
	assert.equal(IDLE_AUDIO_TIMEOUT_MS < 15_000, true);
	assert.equal(SOCKET_OPEN_TIMEOUT_MS > 0 && SOCKET_OPEN_TIMEOUT_MS < 60_000, true);
	assert.equal(TTS_TIMEOUT_MS > 0 && TTS_TIMEOUT_MS < 60_000, true);
	assert.equal(MAX_AUDIO_CHUNK_BYTES, 64 * 1024);
	assert.equal(MAX_TTS_AUDIO_BYTES >= 240_000, true);
});
