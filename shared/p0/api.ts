// P0 wire contracts: response envelopes and the error body shared by every route.
import type { RunModeSchema } from './schemas';
import { SessionSchema } from './schemas';
import { z } from 'zod';

export const OUTCOMES = ['updated', 'unchanged'] as const;
export const OutcomeSchema = z.enum(OUTCOMES);

export const AnalyzeResponseSchema = z.strictObject({
	outcome: OutcomeSchema,
	session: SessionSchema,
});

export const ERROR_CODES = [
	'invalid_input',
	'not_found',
	'stale_revision',
	'stale_artifact',
	'consent_required',
	'fixture_unsupported',
	'provider_failed',
	'invalid_model_output',
	'provider_unconfigured',
	'storage_unavailable',
	'internal_error',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorBodySchema = z.strictObject({
	error: z.strictObject({
		code: ErrorCodeSchema,
		message: z.string(),
		currentRev: z.number().int().min(1).optional(),
	}),
});

export type Outcome = z.infer<typeof OutcomeSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export type RunMode = z.infer<typeof RunModeSchema>;
