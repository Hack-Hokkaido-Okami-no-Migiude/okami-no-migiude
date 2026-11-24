// Seam freeze test: the barrel's VALUE export list must exactly match the
// documented surface in server/voice/README.md. An accidental addition or
// rename fails here before any route starts depending on it.
import * as seam from '../../server/voice/index';
import assert from 'node:assert/strict';
import test from 'node:test';

const FROZEN_VALUE_EXPORTS = [
	'CLOSE_GRACE_MS',
	'DEFAULT_EPOCH_LIFETIME_MS',
	'FINALIZE_WAIT_MS',
	'IDLE_AUDIO_TIMEOUT_MS',
	'LIVE_VOICE_DISCLOSURE',
	'MAX_AUDIO_CHUNK_BYTES',
	'MAX_INBOUND_FRAME_CHARS',
	'MAX_SESSION_MS',
	'MAX_TTS_AUDIO_BYTES',
	'MAX_TTS_TEXT_CHARS',
	'PROVIDER_ERROR_CODES',
	'SCRIBE_AUDIO_FORMAT',
	'SCRIBE_CLOSE_REASONS',
	'SCRIBE_COMMIT_STRATEGY',
	'SCRIBE_ENABLE_LOGGING',
	'SCRIBE_MODEL_ID',
	'SCRIBE_SAMPLE_RATE',
	'SOCKET_OPEN_TIMEOUT_MS',
	'TTS_MODEL_ID',
	'TTS_OUTPUT_FORMAT',
	'TTS_TIMEOUT_MS',
	'VOICE_ERROR_CODES',
	'VOICE_LANGUAGES',
	'VOICE_SEAM_VERSION',
	'VoiceEpochRegistry',
	'VoiceError',
	'assertApprovedQuestion',
	'connectScribeSession',
	'normalizeProviderCode',
	'officialWsBase',
	'openNodeWebSocket',
	'providerErrorPhrase',
	'realClock',
	'speakApprovedQuestion',
	'voiceIdForLanguage',
	'voiceProviderConfig',
] as const;

test('the voice seam surface is exactly the frozen export list', () => {
	const actual = Object.keys(seam).sort();
	assert.deepEqual(actual, [...FROZEN_VALUE_EXPORTS].sort());
	assert.equal(seam.VOICE_SEAM_VERSION, 1);
	assert.equal(seam.SCRIBE_MODEL_ID, 'scribe_v3_live');
	assert.equal(seam.SCRIBE_AUDIO_FORMAT, 'pcm_16000');
	assert.equal(seam.SCRIBE_COMMIT_STRATEGY, 'manual');
	assert.equal(seam.TTS_MODEL_ID, 'eleven_flash_v2_5');
	assert.equal(seam.TTS_OUTPUT_FORMAT, 'mp3_44100_128');
	assert.deepEqual(seam.VOICE_LANGUAGES, ['ja', 'en']);
});
