// Optional idempotent live delivery via the Resend REST API — the §9
// follow-up: "a later configurable mail adapter may use an idempotent provider
// API instead of SMTP". Zero new dependencies: fetch + AbortSignal.timeout are
// platform built-ins.
//
// Safety rails:
// - Resend is the only live email service: it is enabled when
//   MAIL_RESEND_API_KEY is set (and the base URL is valid) — there is no
//   separate provider toggle. No key means the local .eml outbox handles
//   delivery instead.
// - The base URL defaults to https://api.resend.com. An http:// override is
//   accepted only for loopback hosts (the QA stub substitute); anything else
//   is treated as unconfigured, so mail falls back to the local outbox
//   instead of exfiltrating over plain HTTP to an arbitrary host.
// - Every attempt carries `Idempotency-Key: <outbox mail id>` — stable per
//   message (UUID v4, unique per (report, audience, recipient) row) — so a
//   retry after an ambiguous failure (timeout, crash) can never double-send;
//   the provider replays the first result for the same key.
// - Errors are sanitized to the HTTP status only. Request/response bodies, the
//   API key, and recipient/subject content never reach error strings or logs.
// - The mail_outbox schema (contract §9, owned outside server/mail/) has the
//   'local' | 'resend' provider slots; the live provider records 'resend'
//   after a successful send.
import type { LocalMail } from './local';

export type LiveMail = Omit<LocalMail, 'sentAt'>;

const DEFAULT_BASE_URL = 'https://api.resend.com';
const REQUEST_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Validated base URL, or '' when the override is not safe/parseable. */
function configuredBaseUrl(): string {
	const raw = (process.env.MAIL_RESEND_BASE_URL || '').trim();
	if (raw.length === 0) {
		return DEFAULT_BASE_URL;
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

/** Live mode is on whenever the Resend credentials are configured. */
export function liveMailConfigured(): boolean {
	return (
		Boolean(process.env.MAIL_RESEND_API_KEY) && configuredBaseUrl() !== ''
	);
}

/**
 * One idempotent delivery attempt. Resolves on 2xx; throws a sanitized,
 * retryable error otherwise (§8-style retry semantics live in the caller).
 */
export async function deliverLiveMail(mail: LiveMail): Promise<void> {
	// Built separately so the credential never sits on a header-literal line.
	const authorization = `Bearer ${process.env.MAIL_RESEND_API_KEY || ''}`;
	const response = await fetch(`${configuredBaseUrl()}/emails`, {
		method: 'POST',
		headers: {
			authorization,
			'content-type': 'application/json',
			'idempotency-key': mail.id,
		},
		body: JSON.stringify({
			from: mail.from,
			to: mail.to,
			subject: mail.subject,
			text: mail.body,
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(
			`Live mail provider responded with HTTP ${response.status}`,
		);
	}
	// 2xx: accepted for delivery. The provider message id in the response
	// body is intentionally not parsed or logged (no PII / secret surface).
}
