// A test voice config on loopback with shrunken bounds so lifecycle tests
// finish quickly without any real provider contact.
import {
	MAX_AUDIO_CHUNK_BYTES,
	MAX_INBOUND_FRAME_CHARS,
	MAX_TTS_AUDIO_BYTES,
	MAX_TTS_TEXT_CHARS,
	type VoiceProviderConfig,
} from '../../../server/voice/config';

export function testConfig(overrides: Partial<VoiceProviderConfig> = {}): VoiceProviderConfig {
	return {
		apiKey: 'test-server-key',
		baseHttpsUrl: 'https://api.elevenlabs.io',
		baseWsUrl: 'wss://api.elevenlabs.io',
		voiceJa: 'ja-voice-id',
		voiceEn: null,
		timeouts: {
			socketOpenMs: 8_000,
			ttsMs: 15_000,
			finalizeWaitMs: 5_000,
			idleAudioMs: 12_000,
			maxSessionMs: 35 * 60 * 1_000,
			closeGraceMs: 2_000,
		},
		caps: {
			maxAudioChunkBytes: MAX_AUDIO_CHUNK_BYTES,
			maxInboundFrameChars: MAX_INBOUND_FRAME_CHARS,
			maxTtsTextChars: MAX_TTS_TEXT_CHARS,
			maxTtsAudioBytes: MAX_TTS_AUDIO_BYTES,
		},
		...overrides,
	};
}
