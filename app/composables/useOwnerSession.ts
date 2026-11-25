// Owner/staff session state for the whole app.
// Contract for other workers: useOwnerSession() returns
// { user, refreshSession, clearSession } where user is a shared
// Ref<SessionUser | null> (per-request on the server, app-wide on the client).
//
// The session cookie itself is HttpOnly and managed by the server; this
// composable only mirrors the SessionUser returned by GET /api/auth/session.
// Passwords, tokens and other sensitive data never touch web storage — the
// composable (and the whole shell) never writes there.
// No runtime imports on purpose: Nuxt auto-imports useState/$fetch/
// useRequestHeaders, and Node's type stripping lets tests load this file
// directly (including the pure safeInternalPath helper).
import type { SessionUser } from '#shared/types/domain';

export function useOwnerSession() {
	const user = useState<SessionUser | null>(
		'shell:owner-session',
		() => null,
	);

	/**
	 * Re-reads GET /api/auth/session into `user`. During SSR the incoming
	 * cookie header is forwarded so server-rendered pages can render
	 * session-aware chrome without a client round trip.
	 */
	async function refreshSession() {
		const headers =
			import.meta.server ? useRequestHeaders(['cookie']) : undefined;
		const response = await $fetch<{ user: SessionUser | null }>(
			'/api/auth/session',
			{ headers },
		);
		user.value = response.user;
	}

	/** Clears the local mirror (after POST /api/auth/logout). */
	function clearSession() {
		user.value = null;
	}

	return { user, refreshSession, clearSession };
}

/**
 * Pure helper: keeps only internal-safe route paths for ?next= redirects.
 * Accepts absolute local paths like /reports/:id, /interview, /staff, /
 * (optionally with a query string); rejects anything external, protocol-
 * relative, backslashing, control-charactered or non-ASCII. Returns null for
 * anything that is not provably an internal-safe route.
 */
export function safeInternalPath(raw: unknown): string | null {
	if (typeof raw !== 'string') {
		return null;
	}
	if (raw.length === 0 || raw.length > 2048) {
		return null;
	}
	if (!raw.startsWith('/')) {
		return null;
	}
	if (raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\\')) {
		return null;
	}
	// Printable ASCII only — no spaces, control characters or unicode lookalikes.
	// The same check is applied after percent-decoding so '/reports/%E3%81%82'
	// (which decodes to a non-ASCII path) is rejected as well.
	if (!/^[\x21-\x7E]+$/.test(raw)) {
		return null;
	}
	let decoded;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return null;
	}
	if (!/^[\x21-\x7E]+$/.test(decoded)) {
		return null;
	}
	return raw;
}
