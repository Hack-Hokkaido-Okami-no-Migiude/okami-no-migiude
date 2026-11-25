// Shared HTTP plumbing for the API route handlers: the defineApi error
// wrapper, the no-store JSON sender, and raw JSON body parsing.
import { apiError, isApiError } from './errors';
import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3';
import type { H3Event } from 'h3';
import { readJsonObject } from './validate';

/**
 * Wraps a handler so unexpected errors become the §6 envelope
 * (500 `internal`) instead of an unhandled leak, while domain errors
 * (created with apiError) pass through untouched.
 */
export function defineApi(handler: (event: H3Event) => unknown) {
	return defineEventHandler(async (event) => {
		setResponseHeader(event, 'cache-control', 'no-store');
		try {
			return await handler(event);
		} catch (error) {
			if (isApiError(error)) {
				throw error;
			}
			console.error('[api] unexpected error:', error);
			throw apiError(500, 'internal', 'Internal error');
		}
	});
}

/** Private app: every API response is non-cacheable. */
export function sendJson(
	event: H3Event,
	status: number,
	body: unknown,
): unknown {
	setResponseHeader(event, 'cache-control', 'no-store');
	setResponseStatus(event, status);
	return body;
}

export async function parseJsonBody(
	event: H3Event,
	limit = 64 * 1024,
): Promise<Record<string, unknown>> {
	const request = event.node.req;
	const tooLarge = () =>
		apiError(413, 'payload_too_large', 'Request body is too large');
	if (Number(request.headers['content-length']) > limit) {
		request.resume();
		throw tooLarge();
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request.iterator({ destroyOnReturn: false })) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > limit) {
			request.resume();
			throw tooLarge();
		}
		chunks.push(bytes);
	}
	const raw = Buffer.concat(chunks, size).toString('utf8');
	if (raw.trim().length === 0) {
		throw apiError(400, 'validation', 'Request body must be a JSON object');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw apiError(400, 'validation', 'Request body must be valid JSON');
	}
	return readJsonObject(parsed);
}
