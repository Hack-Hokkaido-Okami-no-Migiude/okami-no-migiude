// Recorded-upload provider configuration. The API key is server-only
// (NUXT_ELEVENLABS_API_KEY); the fixed official HTTPS URL is the default and
// only a trusted local/test override (NUXT_ELEVENLABS_BASE_URL, loopback
// plaintext allowed) may change it. Nothing here ever reads request data.
import { OFFICIAL_ELEVENLABS_BASE_URL } from '../../shared/p1/audio';
import { StageError } from '../../shared/p0/stages';

/** Per-transcription HTTP timeout; a 10 MiB recording stays well inside it. */
export const AUDIO_TIMEOUT_MS = 120_000;

/** Short timeout for the best-effort provider-side deletion request. */
export const DELETE_TIMEOUT_MS = 10_000;

export type AudioProviderConfig = {
	baseUrl: string;
	apiKey: string;
	timeoutMs: number;
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

/**
 * Resolve the provider configuration from the environment (injectable for
 * tests). Fails closed with `provider_unconfigured` when the key is missing
 * or the override is not the official HTTPS URL or a loopback test URL.
 */
export function audioProviderConfig(
	env: Record<string, string | undefined> = process.env,
): AudioProviderConfig {
	const apiKey = env.NUXT_ELEVENLABS_API_KEY?.trim() ?? '';
	if (apiKey.length === 0) {
		throw new StageError(
			'provider_unconfigured',
			'Recorded upload is not configured (NUXT_ELEVENLABS_API_KEY is unset); paste the transcript instead.',
		);
	}
	const override = env.NUXT_ELEVENLABS_BASE_URL?.trim() ?? '';
	if (override.length === 0) {
		return { baseUrl: OFFICIAL_ELEVENLABS_BASE_URL, apiKey, timeoutMs: AUDIO_TIMEOUT_MS };
	}
	let parsed: URL;
	try {
		parsed = new URL(override);
	} catch {
		throw invalidBaseUrl();
	}
	const loopback = parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
	if (!(parsed.protocol === 'https:' || loopback)) {
		throw invalidBaseUrl();
	}
	return {
		baseUrl: override.replace(/\/+$/, ''),
		apiKey,
		timeoutMs: AUDIO_TIMEOUT_MS,
	};
}

function invalidBaseUrl(): StageError {
	return new StageError(
		'provider_unconfigured',
		'The recorded-upload base URL override is invalid; use the official HTTPS API URL or a loopback test URL.',
	);
}
