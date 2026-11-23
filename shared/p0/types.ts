// P0 shared types — every type is derived from the zod schemas in `schemas.ts`.
import type {
	AnalyzeRequestSchema,
	AnswerSchema,
	AssumptionSchema,
	ClientSchema,
	EdgeSchema,
	EvidenceRefSchema,
	ExecutionClaimSchema,
	FactorClaimSchema,
	GraphSchema,
	OpportunitySchema,
	PlanSchema,
	PlanSectionSchema,
	ProposalSchema,
	ProposedEdgeSchema,
	ProposedGraphSchema,
	ProposedStepSchema,
	QuestionSchema,
	ReviewNoticeSchema,
	RunSchema,
	SegmentInputSchema,
	SegmentSchema,
	SessionSchema,
	SessionSummarySchema,
	StepSchema,
	StringClaimSchema,
	StringListClaimSchema,
	TranscriptSchema,
} from './schemas';
import type { z } from 'zod';

export type Id = string;

export type Segment = z.infer<typeof SegmentSchema>;
export type SegmentInput = z.infer<typeof SegmentInputSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** A value plus its evidentiary state (`unknown` ⇔ value is null). */
export type StringClaim = z.infer<typeof StringClaimSchema>;
export type StringListClaim = z.infer<typeof StringListClaimSchema>;
export type ExecutionClaim = z.infer<typeof ExecutionClaimSchema>;
export type FactorClaim = z.infer<typeof FactorClaimSchema>;

export type Step = z.infer<typeof StepSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Assumption = z.infer<typeof AssumptionSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type ProposedStep = z.infer<typeof ProposedStepSchema>;
export type ProposedEdge = z.infer<typeof ProposedEdgeSchema>;
export type ProposedGraph = z.infer<typeof ProposedGraphSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Run = z.infer<typeof RunSchema>;
export type ReviewNotice = z.infer<typeof ReviewNoticeSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type Session = z.infer<typeof SessionSchema>;

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/** Fields a completed discovery run replaces wholesale in the session. */
export type DiscoveryPatch = Pick<
	Session,
	'workflow' | 'questions' | 'opportunities' | 'discovery' | 'reviewNotices'
>;
