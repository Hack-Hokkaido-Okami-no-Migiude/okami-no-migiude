// Session cookie lifecycle (§7): opaque 32-byte base64url token in a single
// `session` cookie (HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS), fixed
// 30-day expiry, only the SHA-256 hash of the token stored at rest.
import { deleteCookie, getCookie, setCookie } from 'h3';
import { isoPlusMs, nowIso } from './clock';
import { newSessionToken, sha256Hex } from './ids';
import type { H3Event } from 'h3';
import type { SessionUser } from '#shared/types/domain';
import { apiError } from './errors';
import { getDb } from './db';
import { loadSessionUserByTokenHash } from '../model/users';
import { publicBaseUrl } from './env';

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(event: H3Event, userId: string): void {
	const token = newSessionToken();
	const now = nowIso();
	const previousToken = readSessionToken(event);
	if (previousToken) {
		deleteSessionByToken(previousToken);
	}
	getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
	getDb()
		.prepare(
			'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
		)
		.run(sha256Hex(token), userId, isoPlusMs(now, SESSION_TTL_MS), now);
	setCookie(event, SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		secure: new URL(publicBaseUrl()).protocol === 'https:',
		maxAge: Math.floor(SESSION_TTL_MS / 1000),
	});
}

export function clearSessionCookie(event: H3Event): void {
	deleteCookie(event, SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(event: H3Event): string | null {
	return getCookie(event, SESSION_COOKIE) || null;
}

export function deleteSessionByToken(token: string): void {
	getDb()
		.prepare('DELETE FROM sessions WHERE token_hash = ?')
		.run(sha256Hex(token));
}

export function getSessionUser(event: H3Event): SessionUser | null {
	const token = readSessionToken(event);
	if (!token) {
		return null;
	}
	const user = loadSessionUserByTokenHash(sha256Hex(token));
	if (!user) {
		return null;
	}
	if (user.expiresAt <= nowIso()) {
		return null;
	}
	return user.sessionUser;
}

export function requireUser(event: H3Event): SessionUser {
	const user = getSessionUser(event);
	if (!user) {
		throw apiError(401, 'unauthorized', 'Sign in required');
	}
	return user;
}

export function requireOwner(
	event: H3Event,
): Extract<SessionUser, { role: 'owner' }> {
	const user = requireUser(event);
	if (user.role !== 'owner') {
		throw apiError(403, 'forbidden', 'Owner role required');
	}
	return user;
}

export function requireStaff(
	event: H3Event,
): Extract<SessionUser, { role: 'staff' }> {
	const user = requireUser(event);
	if (user.role !== 'staff') {
		throw apiError(403, 'forbidden', 'Staff role required');
	}
	return user;
}
