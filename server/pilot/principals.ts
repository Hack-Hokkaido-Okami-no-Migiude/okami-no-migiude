import type { PilotRole, VerifiedPilotPrincipal } from './access';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const COOKIE = '__Host-shima-pilot';
const MAX_AGE = 8 * 60 * 60;
const credentialPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const pilotIdPattern = /^[A-Za-z0-9_-]{1,128}(?![\s\S])/;
const roles = new Set<PilotRole>(['owner', 'reviewer', 'admin', 'engineer']);

function isCredential(value: unknown): value is string {
	return (
		typeof value === 'string'
		&& value.length === 43
		&& credentialPattern.test(value)
	);
}

function hash(value: string) {
	return createHash('sha256').update(value, 'ascii').digest();
}

/** Operator provisions independent random 32-byte base64url tokens out of band.
 * Only lowercase SHA-256 hex of each ASCII token is configured, never the token.
 * This checks encoding, not the operator's randomness. No authentication data is logged.
 */
export function createPilotPrincipals(
	businessId: string,
	provisioned: string | undefined,
) {
	if (!provisioned || provisioned.length > 32_768) {
		return null;
	}
	let rows: unknown;
	try {
		rows = JSON.parse(provisioned);
	} catch {
		return null;
	}
	if (!Array.isArray(rows) || rows.length === 0 || rows.length > 128) {
		return null;
	}
	const actors = new Set<string>();
	const digests = new Set<string>();
	const credentials: { principal: VerifiedPilotPrincipal; digest: Buffer }[] =
		[];
	for (const row of rows) {
		if (!row || typeof row !== 'object' || Array.isArray(row)) {
			return null;
		}
		const { actorId, businessId: assignedId, role, tokenSha256 } = row;
		if (
			Object.keys(row).length !== 4
			|| typeof actorId !== 'string'
			|| !pilotIdPattern.test(actorId)
			|| assignedId !== businessId
			|| !roles.has(role)
			|| typeof tokenSha256 !== 'string'
			|| tokenSha256.length !== 64
			|| !/^[a-f0-9]+$/.test(tokenSha256)
			|| actors.has(actorId)
			|| digests.has(tokenSha256)
		) {
			return null;
		}
		actors.add(actorId);
		digests.add(tokenSha256);
		credentials.push({
			principal: Object.freeze({ actorId, businessId, role }),
			digest: Buffer.from(tokenSha256, 'hex'),
		});
	}

	// One process-local session per actor; reissue or restart revokes old cookies.
	const sessions = new Map<string, { digest: Buffer; expiresAt: number }>();
	return {
		issuePrivateCookie(token: unknown): string | null {
			if (!isCredential(token)) {
				return null;
			}
			const submitted = hash(token);
			let principal: VerifiedPilotPrincipal | null = null;
			for (const row of credentials) {
				if (timingSafeEqual(submitted, row.digest)) {
					principal = row.principal;
				}
			}
			// Engineer authentication belongs to separate, not-yet-wired claim ingress.
			if (!principal || principal.role === 'engineer') {
				return null;
			}
			const opaque = randomBytes(32).toString('base64url');
			sessions.set(principal.actorId, {
				digest: hash(opaque),
				expiresAt: Date.now() + MAX_AGE * 1000,
			});
			return `${COOKIE}=${opaque}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`;
		},
		fromPrivateCookie(
			header: string | undefined,
		): VerifiedPilotPrincipal | null {
			if (!header || header.length > 8192) {
				return null;
			}
			let opaque: string | undefined;
			for (const field of header.split(';')) {
				const pair = field.trimStart();
				const equals = pair.indexOf('=');
				if (equals < 0 || pair.slice(0, equals).trimEnd() !== COOKIE) {
					continue;
				}
				if (opaque !== undefined || !pair.startsWith(`${COOKIE}=`)) {
					return null;
				}
				opaque = pair.slice(equals + 1);
			}
			if (!isCredential(opaque)) {
				return null;
			}
			const submitted = hash(opaque);
			const now = Date.now();
			let principal: VerifiedPilotPrincipal | null = null;
			for (const row of credentials) {
				const session = sessions.get(row.principal.actorId);
				if (
					session
					&& timingSafeEqual(submitted, session.digest)
					&& now < session.expiresAt
				) {
					principal = row.principal;
				}
			}
			return principal;
		},
	};
}
