// Pure helpers for the ElevenLabs webhooks (unit-testable without h3):
// HMAC verification for the post-call transcription event and the transcript
// turn formatter. Ported from okami_voice/src/api.ts.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const AGENT_LABEL = 'Shima Enaga';
export const OWNER_LABEL = 'Owner';

/**
 * Verifies the `ElevenLabs-Signature` header: `t=<unix-seconds>,v0=<hex>`
 * where v0 = HMAC-SHA256(secret, `${t}.${raw}`), with a 30-minute window.
 */
export function verifyWebhook(
	raw: Buffer,
	header: string | null,
	secret: string,
): boolean {
	if (!header) {
		return false;
	}
	const fields = header.split(',').map((field) => field.trim());
	const timestamp = fields.find((field) => /^t=\d+$/.test(field))?.slice(2);
	const signature = fields
		.find((field) => /^v0=[0-9a-f]{64}$/i.test(field))
		?.slice(3);
	if (
		!timestamp
		|| !signature
		|| Math.abs(Date.now() / 1000 - Number(timestamp)) > 1800
	) {
		return false;
	}
	const digest = createHmac('sha256', secret)
		.update(`${timestamp}.`)
		.update(raw)
		.digest();
	return timingSafeEqual(Buffer.from(signature, 'hex'), digest);
}

export type TranscriptTurn = { role?: unknown; message?: unknown };

/** Builds the stored transcript ("Owner: …" / "Shima Enaga: …" lines). */
export function toTranscript(turns: unknown): string {
	if (!Array.isArray(turns)) {
		return '';
	}
	return turns
		.flatMap((turn: unknown) => {
			const entry =
				turn && typeof turn === 'object' && !Array.isArray(turn) ?
					(turn as TranscriptTurn)
				:	undefined;
			if (
				!entry
				|| (entry.role !== 'agent' && entry.role !== 'user')
				|| typeof entry.message !== 'string'
			) {
				return [];
			}
			const message = entry.message.trim();
			if (!message) {
				return [];
			}
			return [
				`${entry.role === 'user' ? OWNER_LABEL : AGENT_LABEL}: ${message}`,
			];
		})
		.join('\n');
}

/**
 * Single-line bounded string check for webhook body fields (no control
 * characters that could forge log lines or headers).
 */
export function requiredWebhookString(
	data: Record<string, unknown>,
	key: string,
	maxLength = 200,
): string {
	const value = data[key];
	if (
		typeof value !== 'string'
		|| !value.trim()
		|| value.length > maxLength
		|| /[\r\n]/.test(value)
	) {
		return '';
	}
	return value.trim();
}

/** Timing-safe constant comparison of two secret values via their hashes. */
export function secretMatches(value: string, expected: string): boolean {
	const hash = (input: string) =>
		createHash('sha256').update(input).digest('hex');
	const actual = Buffer.from(hash(value), 'hex');
	const wanted = Buffer.from(hash(expected), 'hex');
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * The server-issued interview id the page passed to the widget as a dynamic
 * variable (`interview_id`), read back out of the post-call webhook payload.
 * The webhook is HMAC-verified server-to-server, so the id is trusted as a
 * lookup key; malformed payloads simply match nothing. Unknown keys and
 * value types are ignored (built-in `system__` variables share the object).
 */
export function readWebhookInterviewId(
	data: Record<string, unknown>,
): string {
	const initiation = data.conversation_initiation_client_data;
	if (
		!initiation
		|| typeof initiation !== 'object'
		|| Array.isArray(initiation)
	) {
		return '';
	}
	const variables = (
		initiation as { dynamic_variables?: unknown }
	).dynamic_variables;
	if (
		!variables
		|| typeof variables !== 'object'
		|| Array.isArray(variables)
	) {
		return '';
	}
	const value = (variables as Record<string, unknown>)['interview_id'];
	if (
		typeof value !== 'string'
		|| !value.trim()
		|| value.length > 64
		|| /[\r\n]/.test(value)
	) {
		return '';
	}
	return value.trim();
}
