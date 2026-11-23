// Shared HTTP plumbing for the P0 routes: request parsing, request schemas for
// routes whose bodies are not (yet) published in shared/p0/schemas.ts, the
// single error body shape, error mapping, and single-flight collapsing for
// identical in-flight runs.
import {
	EvidenceRefSchema,
	ExecutionModeSchema,
	PlanStatusSchema,
	SegmentInputSchema,
	nonblank,
} from '../../shared/p0/schemas';
import {
	type H3Event,
	getQuery,
	getRouterParam,
	readRawBody,
	setResponseStatus,
} from 'h3';
import { StaleArtifactError, StaleSessionError, StoreInputError, StoreLookupError } from '../store/errors';
import { Buffer } from 'node:buffer';
import type { ErrorCodeSchema } from '../../shared/p0/api';
import type { PlanSection } from '../../shared/p0/types';
import { StageError } from '../../shared/p0/stages';
import { StoreUnavailableError } from '../store/repository';
import { z } from 'zod';

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
/** Anything a P0 route may return: JSON objects, arrays of them, or raw text. */
export type P0RouteResult =
	| Record<string, unknown>
	| Record<string, unknown>[]
	| string;

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

// ---------------------------------------------------------------------------
// Request schemas for P0 routes whose bodies are not (yet) published in
// shared/p0/schemas.ts — single source of truth moves there at integration if
// the workbench needs these shapes client-side too.
// ---------------------------------------------------------------------------

/** Non-blank text with a hard length bound. */
function boundedText(maxLength: number) {
	return nonblank().max(maxLength);
}

const MAX_BODY_BYTES = 5_000_000;

export const ClientCreateRequestSchema = z.strictObject({
	name: boundedText(200),
});

export const SessionCreateRequestSchema = z.strictObject({
	title: boundedText(300),
});

export const TranscriptPutRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	segments: z.array(SegmentInputSchema).max(5000),
});

/** One submitted step claim: `{value, evidence}` only, derived server-side. */
const TextFieldSchema = z.strictObject({
	value: z.string().max(2000).nullable(),
	evidence: z.array(EvidenceRefSchema).max(20),
});
const StringListFieldSchema = z.strictObject({
	value: z.array(nonblank().max(2000)).max(100).nullable(),
	evidence: z.array(EvidenceRefSchema).max(20),
});
const ExecutionFieldSchema = z.strictObject({
	value: ExecutionModeSchema.nullable(),
	evidence: z.array(EvidenceRefSchema).max(20),
});

export const StepPatchRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	fields: z
		.strictObject({
			label: TextFieldSchema.optional(),
			role: TextFieldSchema.optional(),
			tool: TextFieldSchema.optional(),
			inputs: StringListFieldSchema.optional(),
			outputs: StringListFieldSchema.optional(),
			execution: ExecutionFieldSchema.optional(),
			bottleneck: TextFieldSchema.optional(),
			exception: TextFieldSchema.optional(),
		})
		.check((ctx) => {
			if (Object.keys(ctx.value).length === 0) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value,
					message: 'at least one step field must be submitted',
				});
			}
		}),
	verify: z.boolean(),
});

export const AnswerPutRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	text: boundedText(5000),
});

const AssumptionInputSchema = z.strictObject({
	value: z
		.number()
		.nullable()
		.refine(
			(value) =>
				value === null || (Number.isFinite(value) && value >= 0),
			{ message: 'must be a finite nonnegative number when present' },
		),
	basis: boundedText(2000),
	evidence: z.array(EvidenceRefSchema).max(20),
});

export const OpportunityPatchRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	assumptions: z
		.strictObject({
			monthlyOccurrences: AssumptionInputSchema.optional(),
			minutesSaved: AssumptionInputSchema.optional(),
		})
		.check((ctx) => {
			if (Object.keys(ctx.value).length === 0) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value,
					message:
						'at least one assumption (monthlyOccurrences or minutesSaved) must be submitted',
				});
			}
		}),
});

const PLAN_SECTIONS_PATCH_SHAPE = {
	scope: boundedText(20000).optional(),
	businessRules: boundedText(20000).optional(),
	integrationsAuth: boundedText(20000).optional(),
	exceptions: boundedText(20000).optional(),
	humanOversight: boundedText(20000).optional(),
	milestones: boundedText(20000).optional(),
	acceptanceTests: boundedText(20000).optional(),
} as const satisfies Record<PlanSection, unknown>;

const PlanSectionsPatchSchema = z.strictObject(PLAN_SECTIONS_PATCH_SHAPE);

export const PlanPatchRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	sections: PlanSectionsPatchSchema.optional(),
	status: PlanStatusSchema.optional(),
}).check((ctx) => {
	if (ctx.value.sections === undefined && ctx.value.status === undefined) {
		ctx.issues.push({
			code: 'custom',
			input: ctx.value,
			message: 'at least one of sections or status must be supplied',
		});
	}
});

/** Read the required `?baseRev=` query parameter for body-less writes. */
export function requireBaseRevQuery(event: H3Event): number {
	const raw = getQuery(event).baseRev;
	const value = Array.isArray(raw) ? raw[0] : raw;
	const parsed =
		typeof value === 'string' && value.trim().length > 0
			? Number(value)
			: Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw invalidInput(
			'Query parameter baseRev must be a positive integer.',
		);
	}
	return parsed;
}

/** Parse a JSON body against a schema; failures become `400 invalid_input`. */
export async function parseJsonBody<T extends z.ZodType>(
	event: H3Event,
	schema: T,
): Promise<z.output<T>> {
	const contentLength = Number(
		event.node.req.headers['content-length'] ?? '0',
	);
	if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
		throw invalidInput('Request body is too large.');
	}
	let rawText: string | null;
	try {
		rawText = (await readRawBody(event, 'utf-8')) ?? null;
	} catch {
		throw invalidInput('Request body must be valid JSON.');
	}
	if (
		rawText !== null
		&& Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES
	) {
		throw invalidInput('Request body is too large.');
	}
	let raw: unknown;
	if (rawText === null || rawText.trim().length === 0) {
		raw = {};
	} else {
		try {
			raw = JSON.parse(rawText);
		} catch {
			throw invalidInput('Request body must be valid JSON.');
		}
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
	if (error instanceof StoreInputError) {
		return new P0HttpError(400, 'invalid_input', error.message);
	}
	if (error instanceof StoreLookupError) {
		return new P0HttpError(404, 'not_found', error.message);
	}
	if (error instanceof StaleSessionError) {
		return new P0HttpError(
			409,
			'stale_revision',
			error.message,
			error.currentRev,
		);
	}
	if (error instanceof StaleArtifactError) {
		return new P0HttpError(409, 'stale_artifact', error.message);
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
