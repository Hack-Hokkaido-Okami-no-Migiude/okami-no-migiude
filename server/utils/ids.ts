import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** IDs are UUID v4 strings generated server-side (§3). */
export function newId(): string {
	return randomUUID();
}

/** Opaque 32-byte session token (base64url) carried by the cookie (§7). */
export function newSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/** Session tokens are stored only as hashes at rest (approved override). */
export function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
