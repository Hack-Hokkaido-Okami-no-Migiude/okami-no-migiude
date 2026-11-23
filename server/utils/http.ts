// Shared HTTP plumbing for the P0 routes: request parsing, single error body
// shape, error mapping, and single-flight collapsing for identical in-flight runs.
import { type H3Event, getRouterParam, readBody, setResponseStatus } from 'h3';
import type { ErrorCodeSchema } from '../../shared/p0/api';
import { StageError } from '../../shared/p0/stages';
import { StoreUnavailableError } from '../store/repository';
import type { z } from 'zod';

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type P0RouteResult = Record<string, unknown> | string;

/** An error that already carries its intended HTTP mapping. */
export class P0HttpError extends Error {
	readonly status: number;
	readonly code: ErrorCode;
	readonly currentRev?: number;

	constructor(
		status: number,
		code: ErrorCode,
		message: string,
		currentRev?: number,
	) {
		super(message);
		this.name = 'P0HttpError';
		this.status = status;
		this.code = code;
		this.currentRev = currentRev;
	}
}

export function notFound(message = 'Unknown client or session.'): P0HttpError {
	return new P0HttpError(404, 'not_found', message);
}

export function invalidInput(
	message = 'Request body failed schema validation.',
): P0HttpError {
	return new P0HttpError(400, 'invalid_input', message);
}

export function staleRevision(
	message: string,
	currentRev: number,
): P0HttpError {
	return new P0HttpError(409, 'stale_revision', message, currentRev);
}

/** Generic factory for route-level errors with an explicit HTTP mapping. */
export function httpError(
	status: number,
	code: ErrorCode,
	message: string,
): P0HttpError {
	return new P0HttpError(status, code, message);
}

/** Parse a JSON body against a schema; failures become `400 invalid_input`. */
export async function parseJsonBody<T extends z.ZodType>(
	event: H3Event,
	schema: T,
): Promise<z.output<T>> {
	let raw: unknown;
	try {
		raw = await readBody(event);
	} catch {
		throw invalidInput('Request body must be valid JSON.');
	}
	if (raw === undefined || raw === null) {
		raw = {};
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		const firstPath = parsed.error.issues[0]?.path.join('.');
		throw invalidInput(
			firstPath ?
				`Request body failed schema validation at ${firstPath}.`
			:	undefined,
		);
	}
	return parsed.data;
}

/** Read a required routing parameter, mapping an invalid id to `404 not_found`. */
export function requireParam(event: H3Event, name: string): string {
	const value = getRouterParam(event, name);
	if (value === undefined || value.trim().length === 0) {
		throw notFound(`Missing ${name} in route.`);
	}
	return value;
}

/**
 * Run a route body with centralized error mapping. Errors are converted into the
 * contract error body; messages are fixed phrases, never raw provider/H3 payloads.
 */
export async function runRoute<T extends P0RouteResult>(
	event: H3Event,
	handler: () => Promise<T>,
): Promise<
	T | { error: { code: ErrorCode; message: string; currentRev?: number } }
> {
	try {
		return await handler();
	} catch (error) {
		const mapped = mapToHttpError(error);
		if (mapped.status >= 500) {
			// Fixed phrase only: raw errors must never leak payloads or secrets.
			console.error(`[p0] ${mapped.code}: ${mapped.message}`);
		}
		setResponseStatus(event, mapped.status);
		const body: {
			error: { code: ErrorCode; message: string; currentRev?: number };
		} = {
			error: { code: mapped.code, message: mapped.message },
		};
		if (mapped.currentRev !== undefined) {
			body.error.currentRev = mapped.currentRev;
		}
		return body;
	}
}

function mapToHttpError(error: unknown): P0HttpError {
	if (error instanceof P0HttpError) {
		return error;
	}
	if (error instanceof StageError) {
		const mapping: Record<string, { status: number; code: ErrorCode }> = {
			invalid_model_output: { status: 502, code: 'invalid_model_output' },
			provider_failed: { status: 502, code: 'provider_failed' },
			fixture_unsupported: { status: 422, code: 'fixture_unsupported' },
			consent_required: { status: 422, code: 'consent_required' },
			provider_unconfigured: {
				status: 503,
				code: 'provider_unconfigured',
			},
		};
		const mapped = mapping[error.code];
		if (mapped) {
			return new P0HttpError(mapped.status, mapped.code, error.message);
		}
		return new P0HttpError(
			500,
			'internal_error',
			'Unexpected server error.',
		);
	}
	if (error instanceof StoreUnavailableError) {
		return new P0HttpError(503, 'storage_unavailable', error.message);
	}
	return new P0HttpError(500, 'internal_error', 'Unexpected server error.');
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Collapse identical in-flight operations (same session/op/revision/artifact key)
 * onto a single promise so concurrent equal requests do not duplicate provider work.
 */
export function singleFlight<T>(
	flightKey: string,
	operation: () => Promise<T>,
): Promise<T> {
	const existing = inFlight.get(flightKey);
	if (existing) {
		return existing as Promise<T>;
	}
	const promise = operation().finally(() => {
		if (inFlight.get(flightKey) === promise) {
			inFlight.delete(flightKey);
		}
	});
	inFlight.set(flightKey, promise);
	return promise;
}
