// Live-voice provider configuration. The API key and voice ids are server-only
// environment values; the fixed official provider origin is the default and
// only a trusted loopback test override may change it. Nothing here reads
// request data, and every live path fails closed when the key is missing.
import { OFFICIAL_ELEVENLABS_BASE_URL } from '../../shared/p1/audio';
import { StageError } from '../../shared/p0/stages';

/** The realtime speech-to-text model pinned by SHIMA-PROVIDERS.md. */
export const SCRIBE_MODEL_ID = 'scribe_v3_live';

/** Fixed PCM encoding for the relay: 16 kHz, 16-bit, little-endian, mono. */
export const SCRIBE_AUDIO_FORMAT = 'pcm_16000';

/** Sample rate implied by `pcm_16000`; forwarded with every audio chunk. */
export const SCRIBE_SAMPLE_RATE = 16_000;

/** Manual commits only: the app's explicit "finish answer" control commits. */
export const SCRIBE_COMMIT_STRATEGY = 'manual';

/** Server-enforced zero-retention request (confirmed only for eligible workspaces). */
export const SCRIBE_ENABLE_LOGGING = false;

/** Interview languages this seam speaks; the voice id is chosen per language. */
export const VOICE_LANGUAGES = ['ja', 'en'] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

/** Text-to-speech model pinned by SHIMA-PROVIDERS.md (Japanese-capable). */
export const TTS_MODEL_ID = 'eleven_flash_v2_5';

/** Fixed TTS output format: MP3, 44.1 kHz, 128 kbps. */
export const TTS_OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * The official realtime WebSocket origin, derived from the shared HTTPS base.
 * The single source of truth for the provider origin stays in shared/p1/audio.
 */
export function officialWsBase(baseUrl: string = OFFICIAL_ELEVENLABS_BASE_URL): string {
	return baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

/** Bound on the whole handshake: TCP + upgrade + `session_started`. */
export const SOCKET_OPEN_TIMEOUT_MS = 8_000;

/** Bound on one text-to-speech request for the selected question. */
export const TTS_TIMEOUT_MS = 15_000;

/** Bound on waiting for a final commit after the owner finishes an answer. */
export const FINALIZE_WAIT_MS = 5_000;

/**
 * Close the relay cleanly when nothing at all has been forwarded for this
 * long. Must stay below the provider's hard 15-second no-client-message
 * limit so the relay closes first, on its own terms.
 */
export const IDLE_AUDIO_TIMEOUT_MS = 12_000;

/** Hard cap on one live capture epoch: 35 minutes of wall-clock time. */
export const MAX_SESSION_MS = 35 * 60 * 1_000;

/** Grace period before a locally requested close is force-abandoned. */
export const CLOSE_GRACE_MS = 2_000;

/** Cap on one forwarded PCM chunk (~2 s of 16 kHz mono 16-bit audio). */
export const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;

/** Cap on inbound provider frames; larger frames are treated as protocol faults. */
export const MAX_INBOUND_FRAME_CHARS = 262_144;

/** Cap on approved question text sent to speech synthesis. */
export const MAX_TTS_TEXT_CHARS = 500;

/** Cap on the speech audio accepted from the provider (~1 MB). */
export const MAX_TTS_AUDIO_BYTES = 1_000_000;

export type VoiceTimeouts = {
	socketOpenMs: number;
	ttsMs: number;
	finalizeWaitMs: number;
	idleAudioMs: number;
	maxSessionMs: number;
	closeGraceMs: number;
};

export type VoiceCaps = {
	maxAudioChunkBytes: number;
	maxInboundFrameChars: number;
	maxTtsTextChars: number;
	maxTtsAudioBytes: number;
};

export type VoiceProviderConfig = {
	apiKey: string;
	/** HTTPS origin for text-to-speech (official, or a loopback test override). */
	baseHttpsUrl: string;
	/** WebSocket origin for the realtime socket (wss official, ws loopback). */
	baseWsUrl: string;
	voiceJa: string | null;
	voiceEn: string | null;
	timeouts: VoiceTimeouts;
	caps: VoiceCaps;
};

function isLoopbackHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return (
		normalized === 'localhost'
		|| normalized === '::1'
		|| normalized === '::ffff:127.0.0.1'
		|| /^127(\.\d{1,3}){3}$/.test(normalized)
	);
}

function defaultTimeouts(): VoiceTimeouts {
	return {
		socketOpenMs: SOCKET_OPEN_TIMEOUT_MS,
		ttsMs: TTS_TIMEOUT_MS,
		finalizeWaitMs: FINALIZE_WAIT_MS,
		idleAudioMs: IDLE_AUDIO_TIMEOUT_MS,
		maxSessionMs: MAX_SESSION_MS,
		closeGraceMs: CLOSE_GRACE_MS,
	};
}

function defaultCaps(): VoiceCaps {
	return {
		maxAudioChunkBytes: MAX_AUDIO_CHUNK_BYTES,
		maxInboundFrameChars: MAX_INBOUND_FRAME_CHARS,
		maxTtsTextChars: MAX_TTS_TEXT_CHARS,
		maxTtsAudioBytes: MAX_TTS_AUDIO_BYTES,
	};
}

function voiceIdFor(env: Record<string, string | undefined>, language: VoiceLanguage): string | null {
	const raw = (language === 'ja' ? env.NUXT_ELEVENLABS_VOICE_ID_JA : env.NUXT_ELEVENLABS_VOICE_ID_EN)?.trim() ?? '';
	return raw.length > 0 ? raw : null;
}

/**
 * Resolve the live-voice configuration from the environment (injectable for
 * tests). Fails closed with `provider_unconfigured` when the API key is
 * missing or when the base override is neither the official HTTPS URL nor a
 * loopback test URL. Voice ids are optional at the configuration level: a
 * deployment may run transcription-only and fail speech requests with a
 * typed `provider_unconfigured` error instead.
 */
export function voiceProviderConfig(
	env: Record<string, string | undefined> = process.env,
): VoiceProviderConfig {
	const apiKey = env.NUXT_ELEVENLABS_API_KEY?.trim() ?? '';
	if (apiKey.length === 0) {
		throw new StageError(
			'provider_unconfigured',
			'Live voice is not configured (NUXT_ELEVENLABS_API_KEY is unset); use the text answer form instead.',
		);
	}
	const override = env.NUXT_ELEVENLABS_BASE_URL?.trim() ?? '';
	if (override.length > 0) {
		let parsed: URL;
		try {
			parsed = new URL(override);
		} catch {
			throw invalidBaseUrl();
		}
		// The voice contract pins the fixed official host: an HTTPS override
		// must BE the official origin, and only a loopback test URL (plain
		// http or https) may differ. Anything else fails closed.
		const official = override.replace(/\/+$/, '') === OFFICIAL_ELEVENLABS_BASE_URL;
		const loopback = isLoopbackHost(parsed.hostname)
			&& (parsed.protocol === 'http:' || parsed.protocol === 'https:');
		if (!(official || loopback)) {
			throw invalidBaseUrl();
		}
	}
	// Base URLs are pure origins: every seam endpoint appends its own fixed
	// path, so a stray path in the override must never leak into the dialed
	// URL (it would double the path segment).
	const parsedBase = new URL(override.length > 0 ? override : OFFICIAL_ELEVENLABS_BASE_URL);
	const baseHttpsUrl = `${parsedBase.protocol}//${parsedBase.host}`;
	return {
		apiKey,
		baseHttpsUrl,
		baseWsUrl: officialWsBase(baseHttpsUrl).replace(/^wss:/, baseHttpsUrl.startsWith('http://') ? 'ws:' : 'wss:'),
		voiceJa: voiceIdFor(env, 'ja'),
		voiceEn: voiceIdFor(env, 'en'),
		timeouts: defaultTimeouts(),
		caps: defaultCaps(),
	};
}

function invalidBaseUrl(): StageError {
	return new StageError(
		'provider_unconfigured',
		'The live-voice base URL override is invalid; use the official HTTPS API URL or a loopback test URL.',
	);
}

/** The configured voice id for a language, or a typed unconfigured error. */
export function voiceIdForLanguage(config: VoiceProviderConfig, language: VoiceLanguage): string {
	const voiceId = language === 'ja' ? config.voiceJa : config.voiceEn;
	if (voiceId === null) {
		throw new StageError(
			'provider_unconfigured',
			`Server speech is not configured for ${language} questions (NUXT_ELEVENLABS_VOICE_ID_${language.toUpperCase()} is unset).`,
		);
	}
	return voiceId;
}
