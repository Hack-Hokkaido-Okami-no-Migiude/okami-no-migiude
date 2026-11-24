// Public Shima schemas. These describe the *separate* public representation
// of one catalog task — the only shape that may ever reach the quest board.
// A public task is never a stripped private draft: it is constructed from a
// small, explicit set of reviewed fields, and every field is validated here so
// private-only structures (evidence, basis, actor ids, package ids) cannot
// ride along.
import { EvidenceRefSchema } from '../p0/schemas';

import { z } from 'zod';

/** How a number was established. Only owner-reported values carry evidence. */
export const QuantityKindSchema = z.enum(['owner-reported', 'assumption', 'unknown']);

const quantityBase = {
	value: z.number().finite().nonnegative().int().nullable(),
	/** Where the number came from, phrased by the person who reported it. */
	basis: z.string().max(2000).nullable(),
	evidence: z.array(EvidenceRefSchema).max(20),
};

export type Quantity = z.infer<typeof QuantitySchema>;

export const QuantitySchema = z
	.object({ kind: QuantityKindSchema, ...quantityBase })
	.refine(
		(quantity) =>
			quantity.kind === 'owner-reported'
				? quantity.evidence.length > 0
				: quantity.evidence.length === 0,
		{ message: 'Only owner-reported quantities carry evidence.' },
	)
	.refine(
		(quantity) =>
			quantity.kind === 'unknown'
				? quantity.value === null && quantity.basis === null
				: quantity.value !== null && quantity.basis !== null && quantity.basis !== '',
		{ message: 'A reported or assumed quantity needs a value and a basis.' },
	);

export type PublicTask = z.infer<typeof PublicTaskSchema>;

const publicTextField = z.string().max(2000);
const publicShortList = z.array(publicTextField).max(10);
const publicList = z.array(publicTextField).max(30);
/** Public headline fields must be non-blank as well as short. */
const publicNonblank = publicTextField.refine(
	(value) => value.trim().length > 0,
	{ message: 'must be non-blank' },
);

/**
 * The checked-in public task: budget and date come from the catalog, savings
 * from the fresh proposal, prose from the current plan. Strict on purpose —
 * a private draft shape (or any extra field) must not validate as public.
 */
export const PublicTaskSchema = z.strictObject({
	title: publicNonblank,
	problem: publicNonblank,
	proposedChange: publicNonblank,
	deliverables: publicShortList,
	acceptanceCriteria: publicShortList,
	skills: publicShortList,
	integrations: publicShortList,
	benefits: publicShortList,
	prerequisites: publicShortList,
	limitations: publicShortList,
	confirmedBudgetYen: z.number().int().min(0).max(100_000_000),
	targetDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.'),
	estimatedHoursSavedPerMonth: z.number().min(0).max(1000),
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

/** The owner-editable subset of a package before any preview or publish. */
export const TaskDraftSchema = z.strictObject({
	title: publicTextField,
	problem: publicTextField,
	proposedChange: publicTextField,
	deliverables: publicList,
	acceptanceCriteria: publicList,
	skills: publicList,
	integrations: publicList,
	benefits: publicList,
	prerequisites: publicList,
	limitations: publicList,
	proposedBudgetYen: z.number().int().min(0).max(100_000_000).nullable(),
	targetDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.')
		.nullable(),
});

export type QuestState = z.infer<typeof QuestStateSchema>;

export const QuestStateSchema = z.enum(['available', 'claimed']);
