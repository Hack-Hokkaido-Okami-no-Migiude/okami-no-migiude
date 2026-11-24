// Persisted Shima rows. They live in the same versioned JSON snapshot as the
// P0 store, under a separate top-level `shima` section, so legacy records are
// untouched and one atomic write covers both. Every row schema is strict: a
// malformed persisted section fails closed instead of being silently repaired.
import { PublicTaskSchema, QuantitySchema, TaskDraftSchema } from '../../shared/shima/schemas';
import { EvidenceRefSchema } from '../../shared/p0/schemas';
import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().min(1);

export type StoredEffort = z.infer<typeof StoredEffortSchema>;

/** One owner-reported effort datum per workflow step. */
export const StoredEffortSchema = z.object({
	stepId: z.string().min(1),
	weeklyOccurrences: QuantitySchema,
	minutesPerOccurrence: QuantitySchema,
	recordedAt: timestamp,
});

export type StoredPreview = z.infer<typeof StoredPreviewSchema>;

/** A prepared public preview: exact task content plus its canonical hash. */
export const StoredPreviewSchema = z.object({
	preview: z.object({
		id: z.string().regex(/^prv_/),
		hash: hex64,
		task: PublicTaskSchema,
	}),
	packageId: z.string().min(1),
	basisKey: hex64,
	catalogVersion: z.number().int().min(1),
	createdAt: timestamp,
});

export type StoredDecision = z.infer<typeof StoredDecisionSchema>;

/** The immutable owner approval recorded at publish time. */
export const StoredDecisionSchema = z.object({
	kind: z.literal('approved'),
	confirmedBudgetYen: z.number().int().min(0),
	previewHash: hex64,
	author: z.object({
		actorId: z.string().min(1),
		role: z.string().min(1),
	}),
});

export type StoredPackage = z.infer<typeof StoredPackageSchema>;

/** A match package plus the audit trail of owner edits. */
export const StoredPackageSchema = z.object({
	package: z.object({
		id: z.string().regex(/^pkg_/),
		opportunityId: z.string().min(1),
		draft: TaskDraftSchema,
		basisKey: hex64,
		evidence: z.array(EvidenceRefSchema).max(20),
		state: z.enum(['draft', 'published']),
		stale: z.boolean(),
		decision: StoredDecisionSchema.nullable(),
		previewId: z.string().regex(/^prv_/).nullable(),
		questId: z.string().regex(/^qst_/).nullable(),
	}),
	editedFields: z.array(z.string()).max(20),
});

export type StoredReceipt = z.infer<typeof StoredReceiptSchema>;

/** A stored response for one idempotency key on one route. */
export const StoredReceiptSchema = z.object({
	route: z.string().min(1),
	fingerprint: hex64,
	response: z.unknown(),
	createdAt: timestamp,
});

export type StoredQuest = z.infer<typeof StoredQuestSchema>;

/** The published public quest; claim receipts live on the quest itself. */
export const StoredQuestSchema = z.object({
	id: z.string().regex(/^qst_/),
	packageId: z.string().regex(/^pkg_/),
	rev: z.number().int().min(1),
	state: z.enum(['available', 'claimed']),
	task: PublicTaskSchema,
	catalogVersion: z.number().int().min(1),
	source: z.object({ clientId: z.string().min(1), sessionId: z.string().min(1) }),
	publishedAt: timestamp,
	assigneeId: z.string().min(1).nullable().optional(),
	claimedAt: timestamp.nullable().optional(),
	receipts: z.record(z.string(), StoredReceiptSchema),
});

export type StoredAssignment = z.infer<typeof StoredAssignmentSchema>;

/** One claim: the digest of the engineer key, never the key itself. */
export const StoredAssignmentSchema = z.object({
	id: z.string().regex(/^asg_/),
	questId: z.string().regex(/^qst_/),
	engineerKeyDigest: hex64,
	claimedAt: timestamp,
});

/** Per-session Shima rows; `rev` is the section's own compare-and-swap base. */
export const ShimaSectionSchema = z.object({
	rev: z.number().int().min(1),
	effort: z.record(z.string(), StoredEffortSchema),
	packages: z.record(z.string(), StoredPackageSchema),
	previews: z.record(z.string(), StoredPreviewSchema),
	receipts: z.record(z.string(), StoredReceiptSchema),
});
export type ShimaSection = z.infer<typeof ShimaSectionSchema>;

/** The whole Shima section of the snapshot; absent in pre-Shima stores. */
export const ShimaStateSchema = z.object({
	version: z.literal(1),
	sessions: z.record(z.string(), ShimaSectionSchema),
	quests: z.record(z.string(), StoredQuestSchema),
	assignments: z.record(z.string(), StoredAssignmentSchema),
});
export type ShimaState = z.infer<typeof ShimaStateSchema>;

/** A fresh, empty per-session section. */
export function emptyShimaSection(): ShimaSection {
	return { rev: 1, effort: {}, packages: {}, previews: {}, receipts: {} };
}
