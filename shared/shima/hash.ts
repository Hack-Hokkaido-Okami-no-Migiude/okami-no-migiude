// The canonical public-task hash: stable JSON (object keys sorted
// recursively, arrays in order) hashed with SHA-256. The preview shown to the
// owner and the hash stored in the approval decision must use this exact
// serialization, so any content drift before publishing fails the hash gate
// instead of silently publishing something the owner never saw.
import { createHash } from 'node:crypto';

export const PUBLIC_TASK_SCHEMA_TAG = 'shima-public-task-v1';

/** Canonical JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
		);
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/** The hash displayed next to the public preview and bound to the approval. */
export function publicTaskHash(task: unknown): string {
	return createHash('sha256')
		.update(
			canonicalJson({ schema: PUBLIC_TASK_SCHEMA_TAG, task }),
			'utf8',
		)
		.digest('hex');
}
