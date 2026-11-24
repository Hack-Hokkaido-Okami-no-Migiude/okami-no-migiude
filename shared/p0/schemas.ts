// P0 shared schemas — single source of truth for persisted shapes and request bodies.
// TS types are derived in `shared/p0/types.ts`; do not hand-maintain parallel shapes.
// Nullable fields use `null`; optional keys appear only in request/patch schemas.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Server-assigned identifiers (`cli_`, `ses_`, `seg_`, … + UUID or fixed fixture constant). */
export const IdSchema = z
	.string()
	.min(1)
	.regex(
		/^[a-z]{1,6}_[a-z0-9][a-z0-9_-]*$/i,
		'expected a prefixed id like cli_…',
	);

/** Non-blank text helper (used for every free-text field). */
export function nonblank() {
	return z
		.string()
		.min(1)
		.refine((value) => value.trim().length > 0, {
			message: 'must be non-blank',
		});
}

/** Finite, nonnegative number or null. */
function nonnegFiniteNullable() {
	return z
		.number()
		.nullable()
		.refine(
			(value) => value === null || (Number.isFinite(value) && value >= 0),
			{
				message: 'must be a finite nonnegative number when present',
			},
		);
}

export const FACT_KEYS = [
	'trigger',
	'actor',
	'tool',
	'handoff',
	'branch-rule',
	'exception',
	'frequency',
	'minutes',
	'integration',
	'risk',
] as const;
export const FactKeySchema = z.enum(FACT_KEYS);

export const CLAIM_STATES = [
	'client-confirmed',
	'inferred',
	'unknown',
	'consultant-verified',
] as const;
export const ClaimStateSchema = z.enum(CLAIM_STATES);
export const CLAIM_AUTHORS = ['analysis', 'consultant'] as const;
export const ClaimAuthorSchema = z.enum(CLAIM_AUTHORS);

export const EXECUTION_MODES = ['manual', 'automated', 'mixed'] as const;
export const ExecutionModeSchema = z.enum(EXECUTION_MODES);

export const FACTOR_NAMES = [
	'impact',
	'frequency',
	'effort',
	'feasibility',
	'risk',
] as const;
export const FactorNameSchema = z.enum(FACTOR_NAMES);

export const OPPORTUNITY_STRATEGIES = [
	'simplify',
	'rules',
	'integration',
	'ai',
] as const;
export const OpportunityStrategySchema = z.enum(OPPORTUNITY_STRATEGIES);

export const EDGE_KINDS = ['sequence', 'decision', 'exception'] as const;
export const EdgeKindSchema = z.enum(EDGE_KINDS);

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export const PrioritySchema = z.enum(PRIORITIES);

export const QUESTION_STATUSES = ['open', 'answered', 'retired'] as const;
export const QuestionStatusSchema = z.enum(QUESTION_STATUSES);

export const PLAN_SECTIONS = [
	'scope',
	'businessRules',
	'integrationsAuth',
	'exceptions',
	'humanOversight',
	'milestones',
	'acceptanceTests',
] as const;
export const PlanSectionSchema = z.enum(PLAN_SECTIONS);

export const PLAN_STATUSES = ['draft', 'in-review', 'approved'] as const;
export const PlanStatusSchema = z.enum(PLAN_STATUSES);

export const RUN_MODES = ['fixture', 'live'] as const;
export const RunModeSchema = z.enum(RUN_MODES);

// ---------------------------------------------------------------------------
// Evidence + claims
// ---------------------------------------------------------------------------

export const EvidenceRefSchema = z.strictObject({
	sourceId: IdSchema,
	sourceRev: z.number().int().min(1),
	quote: nonblank(),
});

/**
 * `Claim<T>`: a value plus its evidentiary state. Refinements:
 * - `unknown` ⇔ `value === null`, and unknown claims carry no evidence.
 * - `inferred` requires ≥1 evidence ref and a non-blank inference label.
 * - `client-confirmed` / `consultant-verified` require ≥1 evidence ref.
 * - The inference label is only allowed on inferred claims.
 */
export function claimSchema<TValueSchema extends z.ZodType>(
	valueSchema: TValueSchema,
) {
	// Generic zod inference cannot resolve `ctx.value` inside `.check()`; the runtime
	// shape below is exactly the object built here, so the cast is safe.
	type ClaimShape = {
		value: unknown;
		state: z.infer<typeof ClaimStateSchema>;
		evidence: z.infer<typeof EvidenceRefSchema>[];
		author: z.infer<typeof ClaimAuthorSchema>;
		inference?: string;
	};
	return z
		.strictObject({
			value: valueSchema,
			state: ClaimStateSchema,
			evidence: z.array(EvidenceRefSchema),
			author: ClaimAuthorSchema,
			inference: z.string().optional(),
		})
		.check((ctx) => {
			const claim = ctx.value as unknown as ClaimShape;
			const issue = (message: string) => {
				ctx.issues.push({ code: 'custom', input: claim, message });
			};
			if (claim.value === null && claim.state !== 'unknown') {
				issue("a null value must use state 'unknown'");
				return;
			}
			if (claim.value !== null && claim.state === 'unknown') {
				issue("state 'unknown' requires a null value");
			}
			if (claim.state === 'unknown' && claim.evidence.length > 0) {
				issue('unknown claims carry no evidence');
			}
			if (claim.state === 'inferred') {
				if (claim.evidence.length < 1) {
					issue(
						'inferred claims require at least one evidence reference',
					);
				}
				if (!claim.inference || claim.inference.trim().length === 0) {
					issue(
						'inferred claims require a non-blank inference label',
					);
				}
			} else if (claim.inference !== undefined) {
				issue('only inferred claims may carry an inference label');
			}
			if (
				(claim.state === 'client-confirmed'
					|| claim.state === 'consultant-verified')
				&& claim.evidence.length < 1
			) {
				issue(
					`${claim.state} claims require at least one evidence reference`,
				);
			}
		});
}

export const StringClaimSchema = claimSchema(z.string().nullable());
export const StringListClaimSchema = claimSchema(
	z.array(nonblank()).nullable(),
);
export const ExecutionClaimSchema = claimSchema(ExecutionModeSchema.nullable());
export const FactorClaimSchema = claimSchema(
	z.enum(['low', 'medium', 'high']).nullable(),
);

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export const SegmentSchema = z
	.strictObject({
		id: IdSchema,
		sourceRev: z.number().int().min(1),
		speaker: z.string().nullable(),
		text: nonblank(),
		startMs: z.number().int().nonnegative().nullable(),
		endMs: z.number().int().nonnegative().nullable(),
	})
	.check((ctx) => {
		const { startMs, endMs } = ctx.value;
		if (startMs !== null && endMs !== null && endMs < startMs) {
			ctx.issues.push({
				code: 'custom',
				input: ctx.value,
				message: 'endMs must not precede startMs',
			});
		}
	});

export const SEGMENT_SOURCES = ['paste', 'audio'] as const;
export const SegmentSourceSchema = z.enum(SEGMENT_SOURCES);

/**
 * Transcript origin. `paste` rows come from pasted text (P0); `audio` marks
 * transcripts that contain rows derived from a recorded upload (P1), whether
 * created fresh or appended to existing rows.
 */
export const TranscriptSchema = z.strictObject({
	source: SegmentSourceSchema,
	segments: z.array(SegmentSchema).max(5000),
});

export const AnswerSchema = z.strictObject({
	id: IdSchema,
	sourceRev: z.number().int().min(1),
	text: nonblank(),
});

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export const StepSchema = z.strictObject({
	id: IdSchema,
	label: StringClaimSchema,
	role: StringClaimSchema,
	tool: StringClaimSchema,
	inputs: StringListClaimSchema,
	outputs: StringListClaimSchema,
	execution: ExecutionClaimSchema,
	bottleneck: StringClaimSchema,
	exception: StringClaimSchema,
	graphEligible: z.boolean(),
});

export const EdgeSchema = z
	.strictObject({
		id: IdSchema,
		fromStepId: IdSchema,
		toStepId: IdSchema,
		kind: EdgeKindSchema,
		condition: StringClaimSchema,
		evidence: z.array(EvidenceRefSchema).min(1),
	})
	.check((ctx) => {
		const edge = ctx.value;
		if (edge.fromStepId === edge.toStepId) {
			ctx.issues.push({
				code: 'custom',
				input: edge,
				message: 'edge endpoints must differ',
			});
		}
		if (
			(edge.kind === 'decision' || edge.kind === 'exception')
			&& (edge.condition.value === null
				|| edge.condition.value.trim().length === 0)
		) {
			ctx.issues.push({
				code: 'custom',
				input: edge,
				message: `${edge.kind} edges require an evidenced condition`,
			});
		}
	});

export const GraphSchema = z
	.strictObject({
		steps: z.array(StepSchema).max(500),
		edges: z.array(EdgeSchema).max(2000),
	})
	.check((ctx) => {
		const graph = ctx.value;
		const stepIds = new Set(graph.steps.map((step) => step.id));
		if (stepIds.size !== graph.steps.length) {
			ctx.issues.push({
				code: 'custom',
				input: graph,
				message: 'duplicate step ids',
			});
		}
		const edgeIds = new Set(graph.edges.map((edge) => edge.id));
		if (edgeIds.size !== graph.edges.length) {
			ctx.issues.push({
				code: 'custom',
				input: graph,
				message: 'duplicate edge ids',
			});
		}
		for (const edge of graph.edges) {
			if (!stepIds.has(edge.fromStepId) || !stepIds.has(edge.toStepId)) {
				ctx.issues.push({
					code: 'custom',
					input: edge,
					message: `edge ${edge.id} references an unknown step`,
				});
			}
		}
	});

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const QuestionSchema = z.strictObject({
	id: IdSchema,
	targetStepId: IdSchema.nullable(),
	factKey: FactKeySchema,
	prompt: nonblank(),
	whyItMatters: nonblank(),
	priority: PrioritySchema,
	status: QuestionStatusSchema,
	answer: AnswerSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const AssumptionSchema = z.strictObject({
	value: nonnegFiniteNullable(),
	basis: nonblank(),
	evidence: z.array(EvidenceRefSchema),
	edited: z.boolean(),
});

export const OpportunitySchema = z.strictObject({
	id: IdSchema,
	title: nonblank(),
	strategy: OpportunityStrategySchema,
	stepIds: z.array(IdSchema).min(1),
	evidence: z.array(EvidenceRefSchema).min(1),
	rationale: nonblank(),
	factors: z.strictObject({
		impact: FactorClaimSchema,
		frequency: FactorClaimSchema,
		effort: FactorClaimSchema,
		feasibility: FactorClaimSchema,
		risk: FactorClaimSchema,
	}),
	benefits: z.array(nonblank()),
	prerequisites: z.array(nonblank()),
	risks: z.array(nonblank()),
	unknowns: z.array(nonblank()),
	assumptions: z.strictObject({
		monthlyOccurrences: AssumptionSchema,
		minutesSaved: AssumptionSchema,
	}),
	/** Server-computed: occurrences × minutes ÷ 60; null when either input is missing. */
	hoursSavedPerMonth: nonnegFiniteNullable(),
});

// ---------------------------------------------------------------------------
// Proposals + plans
// ---------------------------------------------------------------------------

export const ProposedStepSchema = z.strictObject({
	id: IdSchema,
	label: nonblank(),
	currentStepIds: z.array(IdSchema),
	evidence: z.array(EvidenceRefSchema).min(1),
});

export const ProposedEdgeSchema = z
	.strictObject({
		id: IdSchema,
		fromStepId: IdSchema,
		toStepId: IdSchema,
		label: nonblank(),
		evidence: z.array(EvidenceRefSchema).min(1),
	})
	.check((ctx) => {
		const edge = ctx.value;
		if (edge.fromStepId === edge.toStepId) {
			ctx.issues.push({
				code: 'custom',
				input: edge,
				message: 'proposed edge endpoints must differ',
			});
		}
	});

export const ProposedGraphSchema = z
	.strictObject({
		steps: z.array(ProposedStepSchema).max(200),
		edges: z.array(ProposedEdgeSchema).max(500),
	})
	.check((ctx) => {
		const graph = ctx.value;
		const ids = new Set(graph.steps.map((step) => step.id));
		if (ids.size !== graph.steps.length) {
			ctx.issues.push({
				code: 'custom',
				input: graph,
				message: 'duplicate proposed step ids',
			});
		}
		for (const edge of graph.edges) {
			if (!ids.has(edge.fromStepId) || !ids.has(edge.toStepId)) {
				ctx.issues.push({
					code: 'custom',
					input: edge,
					message: `proposed edge ${edge.id} references an unknown proposed step`,
				});
			}
		}
	});

export const PlanSchema = z.strictObject({
	id: IdSchema,
	status: PlanStatusSchema,
	sections: z.record(PlanSectionSchema, z.string()),
	editedSections: z.array(PlanSectionSchema),
});

export const ProposalSchema = z.strictObject({
	opportunityId: IdSchema,
	graph: ProposedGraphSchema,
	plan: PlanSchema,
	mode: RunModeSchema,
	stale: z.boolean(),
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const RunSchema = z.strictObject({
	mode: RunModeSchema,
	completedAt: z.iso.datetime(),
	stale: z.boolean(),
});

export const ReviewNoticeCodeSchema = z.enum([
	'ambiguous_match',
	'lost_evidence',
	'correction_conflict',
	'answer_conflict',
]);
export const ReviewNoticeSchema = z.strictObject({
	code: ReviewNoticeCodeSchema,
	targetId: IdSchema.nullable(),
	message: nonblank(),
});

export const ClientSchema = z.strictObject({
	id: IdSchema,
	name: nonblank(),
});

export const SessionSummarySchema = z.strictObject({
	id: IdSchema,
	clientId: IdSchema,
	title: nonblank(),
	rev: z.number().int().min(1),
	origin: z.enum(['user', 'hotel-demo']),
});

export const SessionSchema = z
	.strictObject({
		id: IdSchema,
		clientId: IdSchema,
		title: nonblank(),
		rev: z.number().int().min(1),
		origin: z.enum(['user', 'hotel-demo']),
		transcript: TranscriptSchema.nullable(),
		workflow: GraphSchema,
		questions: z.array(QuestionSchema),
		opportunities: z.array(OpportunitySchema),
		proposals: z.array(ProposalSchema),
		discovery: RunSchema.nullable(),
		reviewNotices: z.array(ReviewNoticeSchema),
	})
	.check((ctx) => {
		const session = ctx.value;
		const stepIds = new Set(session.workflow.steps.map((step) => step.id));
		const questionIds = new Set(
			session.questions.map((question) => question.id),
		);
		const opportunityIds = new Set(
			session.opportunities.map((opportunity) => opportunity.id),
		);
		if (questionIds.size !== session.questions.length) {
			ctx.issues.push({
				code: 'custom',
				input: session,
				message: 'duplicate question ids',
			});
		}
		if (opportunityIds.size !== session.opportunities.length) {
			ctx.issues.push({
				code: 'custom',
				input: session,
				message: 'duplicate opportunity ids',
			});
		}
		for (const question of session.questions) {
			if (
				question.targetStepId !== null
				&& !stepIds.has(question.targetStepId)
			) {
				ctx.issues.push({
					code: 'custom',
					input: question,
					message: `question ${question.id} targets an unknown step`,
				});
			}
		}
		for (const opportunity of session.opportunities) {
			for (const stepId of opportunity.stepIds) {
				if (!stepIds.has(stepId)) {
					ctx.issues.push({
						code: 'custom',
						input: opportunity,
						message: `opportunity ${opportunity.id} references an unknown step`,
					});
				}
			}
		}
		for (const proposal of session.proposals) {
			if (!opportunityIds.has(proposal.opportunityId)) {
				ctx.issues.push({
					code: 'custom',
					input: proposal,
					message: `proposal references an unknown opportunity ${proposal.opportunityId}`,
				});
			}
		}
	});

// ---------------------------------------------------------------------------
// Request bodies (optional keys live only here)
// ---------------------------------------------------------------------------

export const SegmentInputSchema = z.strictObject({
	id: IdSchema.optional(),
	sourceRev: z.number().int().min(1).optional(),
	speaker: z.string().nullable().optional(),
	text: nonblank(),
	startMs: z.number().int().nonnegative().nullable().optional(),
	endMs: z.number().int().nonnegative().nullable().optional(),
});

export const AnalyzeRequestSchema = z.strictObject({
	baseRev: z.number().int().min(1),
	mode: RunModeSchema,
	allowExternal: z.literal(true).optional(),
});

/** The proposal action accepts the same request shape as `/analyze`. */
export const ProposalRequestSchema = AnalyzeRequestSchema;

/** The demo seed action takes an empty body; any object is tolerated for robustness. */
export const DemoHotelRequestSchema = z.looseObject({});
