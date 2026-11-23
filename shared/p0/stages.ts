// P0 analysis stage schemas: bounded provider inputs/outputs, the stage error type,
// and the fixture binding contract. Providers (fixture or live) speak only these
// shapes; parsing/validation/reconciliation happens in `server/analysis/**` for
// both modes, so a fixture run exercises the same code paths as a live one.
import {
	EdgeKindSchema,
	FactKeySchema,
	GraphSchema,
	IdSchema,
	OpportunitySchema,
	PrioritySchema,
	ReviewNoticeCodeSchema,
	TranscriptSchema,
	nonblank,
} from './schemas';
import { z } from 'zod';

/** Bump when a stage contract changes shape or meaning. */
export const STAGE_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Stage error type (published for the wave; HTTP mapping lives in server/utils/http.ts)
// ---------------------------------------------------------------------------

export const STAGE_ERROR_CODES = [
	'invalid_model_output',
	'provider_failed',
	'fixture_unsupported',
	'consent_required',
	'provider_unconfigured',
] as const;
export type StageErrorCode = (typeof STAGE_ERROR_CODES)[number];

export class StageError extends Error {
	readonly code: StageErrorCode;

	constructor(code: StageErrorCode, message: string) {
		super(message);
		this.name = 'StageError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Fixture binding: a provider may only answer for a known source variant of a
// known persisted session (checked against real segment ids + fingerprint), never
// for dynamic answers — those always require a live provider or a documented variant.
// ---------------------------------------------------------------------------

export const FixtureBindingSchema = z.strictObject({
	variant: z.string().min(1),
	clientId: IdSchema,
	sessionId: IdSchema,
	sourceFingerprint: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Evidence candidates: what a provider cites before the server resolves it to a
// validated `EvidenceRef` (verbatim substring at the cited revision).
// ---------------------------------------------------------------------------

export const EvidenceCandidateSchema = z.strictObject({
	sourceId: IdSchema,
	sourceRev: z.number().int().min(1),
	quote: nonblank(),
});

// ---------------------------------------------------------------------------
// extract: transcript + saved answers in, candidate workflow out (local keys only;
// the server resolves keys to persisted ids server-side and rejects collisions).
// ---------------------------------------------------------------------------

export const ExtractInputSchema = z.strictObject({
	variant: z.string().min(1),
	clientId: IdSchema,
	sessionId: IdSchema,
	transcript: TranscriptSchema,
	answers: z
		.array(
			z.strictObject({
				questionId: IdSchema,
				factKey: FactKeySchema,
				targetStepId: IdSchema.nullable(),
				// A saved answer is first-class evidence: its persisted id and
				// revision let a live provider cite it like a transcript row
				// (sourceId = answerId, sourceRev = answerRev).
				answerId: IdSchema,
				answerRev: z.number().int().min(1),
				text: nonblank(),
			}),
		)
		.max(500),
	hints: z
		.array(z.strictObject({ id: IdSchema, label: z.string() }))
		.max(200),
});

export const ExtractOutputSchema = z.strictObject({
	steps: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				label: nonblank(),
				role: z.string().nullable(),
				tool: z.string().nullable(),
				execution: z.enum(['manual', 'automated', 'mixed']).nullable(),
				evidence: z.array(EvidenceCandidateSchema).min(1),
				/** Quoted phrases this step can be re-matched by on later runs. */
				anchors: z
					.array(
						z
							.string()
							.min(1)
							.refine((value) => value.trim().length > 0, {
								message: 'must be non-blank',
							}),
					)
					.min(1),
			}),
		)
		.max(100),
	transitions: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				fromKey: z.string().min(1),
				toKey: z.string().min(1),
				kind: EdgeKindSchema,
				condition: z.string().nullable(),
				evidence: EvidenceCandidateSchema,
				fromAnchor: nonblank(),
				toAnchor: nonblank(),
			}),
		)
		.max(200),
	unknowns: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				stepKey: z.string().nullable(),
				factKey: FactKeySchema,
				prompt: nonblank(),
				whyItMatters: nonblank(),
				priority: PrioritySchema,
			}),
		)
		.max(100),
	opportunities: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				title: nonblank(),
				strategy: z.enum(['simplify', 'rules', 'integration', 'ai']),
				stepKeys: z.array(z.string().min(1)).min(1),
				rationale: nonblank(),
				evidence: z.array(EvidenceCandidateSchema).min(1),
				benefits: z.array(z.string()),
				prerequisites: z.array(z.string()),
				risks: z.array(z.string()),
				unknowns: z.array(z.string()),
				factors: z
					.array(
						z.strictObject({
							factor: z.enum([
								'impact',
								'frequency',
								'effort',
								'feasibility',
								'risk',
							]),
							level: z.enum(['low', 'medium', 'high']),
							evidence: EvidenceCandidateSchema,
						}),
					)
					.max(10),
				assumptions: z
					.array(
						z.strictObject({
							which: z.enum([
								'monthlyOccurrences',
								'minutesSaved',
							]),
							value: z.number().nullable(),
							basis: nonblank(),
							evidence: EvidenceCandidateSchema,
						}),
					)
					.max(2),
			}),
		)
		.max(50),
});

// ---------------------------------------------------------------------------
// assess: the provider reviews extraction candidates against the original source
// text as data. The server independently re-verifies every accepted transition
// (provenance validation, not factual certification).
// ---------------------------------------------------------------------------

export const AssessInputSchema = z.strictObject({
	variant: z.string().min(1),
	clientId: IdSchema,
	sessionId: IdSchema,
	sources: z
		.array(
			z.strictObject({
				id: IdSchema,
				sourceRev: z.number().int().min(1),
				text: nonblank(),
			}),
		)
		.max(2000),
	extraction: ExtractOutputSchema,
});

export const AssessRejectionReasonSchema = z.enum([
	'no_transition_phrase',
	'missing_anchor',
	'unresolved_endpoint',
	'other',
]);

export const AssessOutputSchema = z.strictObject({
	acceptedTransitionKeys: z.array(z.string()).max(200),
	rejected: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				reason: AssessRejectionReasonSchema,
				detail: z.string(),
			}),
		)
		.max(200),
	notices: z
		.array(
			z.strictObject({
				code: ReviewNoticeCodeSchema,
				targetId: IdSchema.nullable(),
				message: nonblank(),
			}),
		)
		.max(50),
});

// ---------------------------------------------------------------------------
// propose: current graph + one opportunity in, proposed graph + plan sections out.
// ---------------------------------------------------------------------------

export const ProposeInputSchema = z.strictObject({
	variant: z.string().min(1),
	clientId: IdSchema,
	sessionId: IdSchema,
	opportunity: OpportunitySchema,
	graph: GraphSchema,
	sources: z
		.array(
			z.strictObject({
				id: IdSchema,
				sourceRev: z.number().int().min(1),
				text: nonblank(),
			}),
		)
		.max(2000),
});

export const ProposeOutputSchema = z.strictObject({
	planKey: z.string().min(1),
	steps: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				label: nonblank(),
				currentStepIds: z.array(IdSchema),
				evidence: z.array(EvidenceCandidateSchema).min(1),
			}),
		)
		.max(100),
	edges: z
		.array(
			z.strictObject({
				key: z.string().min(1),
				fromKey: z.string().min(1),
				toKey: z.string().min(1),
				label: nonblank(),
				evidence: z.array(EvidenceCandidateSchema).min(1),
			}),
		)
		.max(200),
	planSections: z.record(
		z.enum([
			'scope',
			'businessRules',
			'integrationsAuth',
			'exceptions',
			'humanOversight',
			'milestones',
			'acceptanceTests',
		]),
		nonblank(),
	),
});

// Convenience aliases for consumers of the stage schemas.
export type FixtureBinding = z.infer<typeof FixtureBindingSchema>;
export type ExtractInput = z.infer<typeof ExtractInputSchema>;
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
export type AssessInput = z.infer<typeof AssessInputSchema>;
export type AssessOutput = z.infer<typeof AssessOutputSchema>;
export type ProposeInput = z.infer<typeof ProposeInputSchema>;
export type ProposeOutput = z.infer<typeof ProposeOutputSchema>;
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;
