// Voice agent configuration (merged from the okami_voice demo). Live voice
// chat is available only when every required credential is present in the
// server environment. Dify powers the post-call assessment; it has its own
// gate (difyConfigured) and is deliberately not part of voiceConfigured, so
// a deployment without Dify keeps the conversation + research surface.
//
// QA knobs: ELEVENLABS_API_BASE_URL / LINKUP_API_BASE_URL /
// DIFY_API_BASE_URL point the provider calls at loopback stubs, mirroring
// MAIL_RESEND_BASE_URL — https always allowed, plain http only for loopback
// hosts so nothing else can be exfiltrated over plain HTTP by a stray env
// value.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
export const LINKUP_DEFAULT_BASE_URL = 'https://api.linkup.so';
export const DIFY_DEFAULT_BASE_URL = 'https://api.dify.ai';

export type VoiceConfig = {
	elevenLabsApiKey: string;
	elevenLabsAgentId: string;
	elevenLabsWebhookSecret: string;
	researchToolSecret: string;
	linkupApiKey: string;
	difyApiKey: string;
	/** Resolved ElevenLabs base URL; '' when an override is unsafe. */
	elevenLabsApiBaseUrl: string;
	/** Resolved Linkup base URL; '' when an override is unsafe. */
	linkupApiBaseUrl: string;
	/** Resolved Dify base URL; '' when an override is unsafe. */
	difyApiBaseUrl: string;
};

function trimmedEnv(name: string): string {
	return (process.env[name] || '').trim();
}

/** Validated provider base URL: default when unset, '' when unsafe. */
function providerBaseUrl(name: string, fallback: string): string {
	const raw = trimmedEnv(name);
	if (raw.length === 0) {
		return fallback;
	}
	try {
		const url = new URL(raw);
		const isLoopbackHttp =
			url.protocol === 'http:'
			&& LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
		if (url.protocol === 'https:' || isLoopbackHttp) {
			return raw.replace(/\/+$/, '');
		}
	} catch {
		// Unparseable override falls through to "not configured".
	}
	return '';
}

export function readVoiceConfig(): VoiceConfig {
	return {
		elevenLabsApiKey: trimmedEnv('ELEVENLABS_API_KEY'),
		elevenLabsAgentId: trimmedEnv('ELEVENLABS_AGENT_ID'),
		elevenLabsWebhookSecret: trimmedEnv('ELEVENLABS_WEBHOOK_SECRET'),
		researchToolSecret: trimmedEnv('RESEARCH_TOOL_SECRET'),
		linkupApiKey: trimmedEnv('LINKUP_API_KEY'),
		difyApiKey: trimmedEnv('DIFY_API_KEY'),
		elevenLabsApiBaseUrl: providerBaseUrl(
			'ELEVENLABS_API_BASE_URL',
			ELEVENLABS_DEFAULT_BASE_URL,
		),
		linkupApiBaseUrl: providerBaseUrl(
			'LINKUP_API_BASE_URL',
			LINKUP_DEFAULT_BASE_URL,
		),
		difyApiBaseUrl: providerBaseUrl(
			'DIFY_API_BASE_URL',
			DIFY_DEFAULT_BASE_URL,
		),
	};
}

/** Voice chat is offered only when every required credential is present. */
export function voiceConfigured(): boolean {
	const config = readVoiceConfig();
	return (
		config.elevenLabsApiKey.length > 0
		&& config.elevenLabsAgentId.length > 0
		&& config.elevenLabsWebhookSecret.length > 0
		&& config.researchToolSecret.length > 0
		&& config.linkupApiKey.length > 0
		&& config.elevenLabsApiBaseUrl.length > 0
		&& config.linkupApiBaseUrl.length > 0
	);
}

/** The post-call assessment (Dify report + mail) runs only when configured. */
export function difyConfigured(): boolean {
	const config = readVoiceConfig();
	return config.difyApiKey.length > 0 && config.difyApiBaseUrl.length > 0;
}

/**
 * The live interview surface: the agent id drives the conversation, the
 * webhook secret verifies the post-call transcript and the API key mints
 * the conversation token (the agent is private, so the browser cannot
 * fetch one itself). Without all three there is no way to record a
 * conversation, so live mode is honestly unavailable — the research/report
 * stack (Linkup, Dify) is gated separately and degrades to its own honest
 * states.
 */
export function agentConfigured(): boolean {
	const config = readVoiceConfig();
	return (
		config.elevenLabsApiKey.length > 0
		&& config.elevenLabsAgentId.length > 0
		&& config.elevenLabsWebhookSecret.length > 0
	);
}
