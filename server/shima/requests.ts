// Request contracts for the Shima tracer routes plus the idempotency plumbing:
// every mutating Shima route requires a UUID idempotency key whose fingerprint
// (canonical request JSON) distinguishes a replay from a conflicting reuse.
import type { H3Event } from 'h3';
import { QuantitySchema } from '../../shared/shima/schemas';
import { canonicalJson } from '../../shared/shima/hash';
import { createHash } from 'node:crypto';
import { getHeader } from 'h3';
import { invalidInput } from '../utils/http';
import { z } from 'zod';

const dateText = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');

export const ShimaEffortPutRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	effort: z.strictObject({
		weeklyOccurrences: QuantitySchema,
		minutesPerOccurrence: QuantitySchema,
	}),
});

export const ShimaPackageCreateRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	opportunityId: z.string().min(1),
});

export const ShimaPackagePatchRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	fields: z
		.strictObject({
			proposedBudgetYen: z.number().int().min(0).max(100_000_000).nullable().optional(),
			targetDate: dateText.nullable().optional(),
		})
		.check((ctx) => {
			if (Object.keys(ctx.value).length === 0) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value,
					message: 'at least one draft field must be submitted',
				});
			}
		}),
});

export const ShimaPreviewRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
});

export const ShimaPublishRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	previewId: z.string().min(1),
	previewHash: z.string().regex(/^[0-9a-f]{64}$/),
	confirmedBudgetYen: z.number().int().min(0).max(100_000_000),
	confirmBudget: z.literal(true),
	approvePreview: z.literal(true),
});

export const ShimaClaimRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
});

const IdempotencyKeySchema = z.string().uuid();

/** Read and validate the required idempotency-key header. */
export function requireIdempotencyKey(event: H3Event): string {
	const raw = getHeader(event, 'idempotency-key')?.trim() ?? '';
	if (!IdempotencyKeySchema.safeParse(raw).success) {
		throw invalidInput('Header idempotency-key must be a UUID.');
	}
	return raw;
}

/**
 * The canonical fingerprint of one request's DOMAIN input for receipt
 * comparisons. `baseRev` is deliberately excluded: it is CAS bookkeeping that
 * legitimately advances between a write and its replay, so a replay after a
 * revision bump is not a conflicting reuse. Domain fields (what would actually
 * change the outcome) are what distinguish a replay from a conflict.
 */
export function receiptFingerprint(body: unknown): string {
	return createHash('sha256')
		.update(canonicalJson(body), 'utf8')
		.digest('hex');
}

/** Fingerprint inputs per route, each the route's outcome-affecting fields. */
export function createReceiptFingerprint(body: { opportunityId: string }): string {
	return receiptFingerprint({ opportunityId: body.opportunityId });
}

export function patchReceiptFingerprint(body: { fields: unknown }): string {
	return receiptFingerprint({ fields: body.fields });
}

export function effortReceiptFingerprint(body: { effort: unknown }): string {
	return receiptFingerprint({ effort: body.effort });
}

export function previewReceiptFingerprint(): string {
	return receiptFingerprint({});
}

export function publishReceiptFingerprint(body: {
	previewId: string;
	previewHash: string;
	confirmedBudgetYen: number;
	confirmBudget: boolean;
	approvePreview: boolean;
}): string {
	return receiptFingerprint({
		previewId: body.previewId,
		previewHash: body.previewHash,
		confirmedBudgetYen: body.confirmedBudgetYen,
		confirmBudget: body.confirmBudget,
		approvePreview: body.approvePreview,
	});
}
