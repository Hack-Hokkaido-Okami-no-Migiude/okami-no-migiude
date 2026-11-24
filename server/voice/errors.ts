// Voice seam error types and redacted provider failure phrases. Provider
// messages, URLs, credentials, and transcript text are never included in any
// error: failures are reported with fixed phrases and fixed provider codes
// only. The codes are the documented ElevenLabs realtime error types.
/** Fixed provider error types from the documented realtime event reference. */
export const PROVIDER_ERROR_CODES = [
	'auth_error',
	'quota_exceeded',
	'transcriber_error',
	'input_error',
	'invalid_request',
	'error',
	'commit_throttled',
	'unaccepted_terms',
	'rate_limited',
	'queue_overflow',
	'resource_exhausted',
	'session_time_limit_exceeded',
	'chunk_size_exceeded',
	'insufficient_audio_activity',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/**
 * Fixed, reviewable phrases per provider error type. These are the ONLY text
 * shown or logged for provider failures — never the provider's own message.
 */
const PROVIDER_ERROR_PHRASES: Record<ProviderErrorCode, string> = {
	auth_error: 'The voice provider rejected the server credentials.',
	quota_exceeded: 'The voice provider quota is exhausted.',
	transcriber_error: 'The voice provider could not transcribe the audio.',
	input_error: 'The provider rejected an audio chunk.',
	invalid_request: 'The provider rejected the connection settings.',
	error: 'The voice provider reported an error.',
	commit_throttled: 'The provider throttled the commit request.',
	unaccepted_terms: 'The provider terms are not accepted for this account.',
	rate_limited: 'The provider is rate limiting this session.',
	queue_overflow: 'The provider processing queue is full.',
	resource_exhausted: 'The provider is out of capacity.',
	session_time_limit_exceeded: 'The provider session time limit was reached.',
	chunk_size_exceeded: 'An audio chunk exceeded the provider size limit.',
	insufficient_audio_activity: 'The provider closed the session for inactivity.',
};

/** Normalize any provider error frame to a fixed code from the enum. */
export function normalizeProviderCode(raw: unknown): ProviderErrorCode {
	return PROVIDER_ERROR_CODES.includes(raw as ProviderErrorCode)
		? (raw as ProviderErrorCode)
		: 'error';
}

/** The fixed phrase for a provider error code; never provider-supplied text. */
export function providerErrorPhrase(code: ProviderErrorCode): string {
	return PROVIDER_ERROR_PHRASES[code];
}

/**
 * Lifecycle errors of the voice seam that routes must map themselves
 * (the shared StageError mapping has no fitting code). Intended mapping:
 * `epoch_active` → 409 typed conflict; `epoch_not_active` and
 * `chunk_too_large` are server-internal misuse; `question_invalid` → 400.
 */
export const VOICE_ERROR_CODES = [
	'epoch_active',
	'epoch_not_active',
	'chunk_too_large',
	'question_invalid',
] as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number];

export class VoiceError extends Error {
	readonly code: VoiceErrorCode;

	constructor(code: VoiceErrorCode, message: string) {
		super(message);
		this.name = 'VoiceError';
		this.code = code;
	}
}
