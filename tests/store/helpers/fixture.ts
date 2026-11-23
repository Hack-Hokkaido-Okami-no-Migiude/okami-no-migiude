// Builders for schema-valid P0 fixtures in store tests. Everything returned is
// parsed through the shared schemas, so a test failure points at the behavior
// under test rather than at an invalid fixture.
import type {
	Answer,
	Assumption,
	Client,
	Edge,
	EvidenceRef,
	Id,
	Opportunity,
	Plan,
	Proposal,
	Question,
	ReviewNotice,
	Run,
	Segment,
	Session,
	Step,
} from '../../../shared/p0/types';
import {
	AnswerSchema,
	AssumptionSchema,
	ClientSchema,
	EdgeSchema,
	EvidenceRefSchema,
	OpportunitySchema,
	PlanSchema,
	ProposalSchema,
	QuestionSchema,
	ReviewNoticeSchema,
	RunSchema,
	SegmentSchema,
	SessionSchema,
	StepSchema,
	TranscriptSchema,
} from '../../../shared/p0/schemas';
import type { StringClaimSchema } from '../../../shared/p0/schemas';
import type { z } from 'zod';

export type TextClaim = z.infer<typeof StringClaimSchema>;

export function evidence(
	sourceId: Id,
	sourceRev: number,
	quote: string,
): EvidenceRef {
	return EvidenceRefSchema.parse({ sourceId, sourceRev, quote });
}

export function inferredTextClaim(value: string, refs: EvidenceRef[]): TextClaim {
	return {
		value,
		state: 'inferred',
		author: 'analysis',
		evidence: refs,
		inference: 'Inferred from the cited interview text.',
	};
}

export function verifiedTextClaim(value: string, refs: EvidenceRef[]): TextClaim {
	return {
		value,
		state: 'consultant-verified',
		author: 'consultant',
		evidence: refs,
	};
}

export function unknownTextClaim(): TextClaim {
	return { value: null, state: 'unknown', author: 'analysis', evidence: [] };
}

export function segment(
	id: Id,
	text: string,
	sourceRev = 1,
	speaker: string | null = 'Interviewer',
): Segment {
	return SegmentSchema.parse({
		id,
		sourceRev,
		speaker,
		text,
		startMs: null,
		endMs: null,
	});
}

export function answerRecord(id: Id, text: string, sourceRev = 1): Answer {
	return AnswerSchema.parse({ id, sourceRev, text });
}

export function notEstablishedAssumption(): Assumption {
	return AssumptionSchema.parse({
		value: null,
		basis: 'Not yet established.',
		evidence: [],
		edited: false,
	});
}

export function step(
	id: Id,
	label: TextClaim,
	overrides: Partial<Omit<Step, 'id' | 'label'>> = {},
): Step {
	return StepSchema.parse({
		id,
		label,
		role: unknownTextClaim(),
		tool: unknownTextClaim(),
		inputs: unknownTextClaim(),
		outputs: unknownTextClaim(),
		execution: unknownTextClaim(),
		bottleneck: unknownTextClaim(),
		exception: unknownTextClaim(),
		graphEligible: label.value !== null,
		...overrides,
	});
}

export function edge(
	id: Id,
	fromStepId: Id,
	toStepId: Id,
	refs: EvidenceRef[],
	overrides: Partial<Omit<Edge, 'id' | 'fromStepId' | 'toStepId' | 'evidence'>> = {},
): Edge {
	return EdgeSchema.parse({
		id,
		fromStepId,
		toStepId,
		kind: 'sequence',
		condition: unknownTextClaim(),
		evidence: refs,
		...overrides,
	});
}

export function question(
	id: Id,
	targetStepId: Id | null,
	factKey: 'trigger' | 'actor' | 'tool' | 'handoff' | 'branch-rule' | 'exception' | 'frequency' | 'minutes' | 'integration' | 'risk',
	overrides: Partial<Omit<Question, 'id' | 'targetStepId' | 'factKey'>> = {},
): Question {
	return QuestionSchema.parse({
		id,
		targetStepId,
		factKey,
		prompt: 'What is missing here?',
		whyItMatters: 'It changes the proposed workflow.',
		priority: 'medium',
		status: 'open',
		answer: null,
		...overrides,
	});
}

export function opportunity(
	id: Id,
	stepIds: Id[],
	refs: EvidenceRef[],
	overrides: Partial<Omit<Opportunity, 'id' | 'stepIds' | 'evidence'>> = {},
): Opportunity {
	return OpportunitySchema.parse({
		id,
		title: 'Automate the manual entry',
		strategy: 'integration',
		stepIds,
		evidence: refs,
		rationale: 'Manual entry is slow and error prone.',
		factors: {
			impact: unknownTextClaim(),
			frequency: unknownTextClaim(),
			effort: unknownTextClaim(),
			feasibility: unknownTextClaim(),
			risk: unknownTextClaim(),
		},
		benefits: ['Fewer double bookings'],
		prerequisites: [],
		risks: [],
		unknowns: [],
		assumptions: {
			monthlyOccurrences: notEstablishedAssumption(),
			minutesSaved: notEstablishedAssumption(),
		},
		hoursSavedPerMonth: null,
		...overrides,
	});
}

export function plan(id: Id): Plan {
	return PlanSchema.parse({
		id,
		status: 'draft',
		sections: {
			scope: 'Draft scope.',
			businessRules: 'Draft business rules.',
			integrationsAuth: 'Draft integrations and auth.',
			exceptions: 'Draft exceptions.',
			humanOversight: 'Draft human oversight.',
			milestones: 'Draft milestones.',
			acceptanceTests: 'Draft acceptance tests.',
		},
		editedSections: [],
	});
}

export function proposal(
	opportunityId: Id,
	planId: Id,
	overrides: Partial<Omit<Proposal, 'opportunityId'>> = {},
): Proposal {
	return ProposalSchema.parse({
		opportunityId,
		graph: { steps: [], edges: [] },
		plan: plan(planId),
		mode: 'fixture',
		stale: false,
		...overrides,
	});
}

export function run(mode: 'fixture' | 'live', stale = false): Run {
	return RunSchema.parse({
		mode,
		completedAt: '2026-01-01T00:00:00.000Z',
		stale,
	});
}

export function notice(
	code: ReviewNotice['code'],
	targetId: Id | null,
	message: string,
): ReviewNotice {
	return ReviewNoticeSchema.parse({ code, targetId, message });
}

export function client(id: Id, name = 'Test client'): Client {
	return ClientSchema.parse({ id, name });
}

export type SessionParts = {
	id?: Id;
	clientId?: Id;
	title?: string;
	rev?: number;
	origin?: 'user' | 'hotel-demo';
	segments?: Segment[];
	steps?: Step[];
	edges?: Edge[];
	questions?: Question[];
	opportunities?: Opportunity[];
	proposals?: Proposal[];
	discovery?: Run | null;
	reviewNotices?: ReviewNotice[];
};

/** A schema-valid session with a two-row transcript and a two-step graph. */
export function makeSession(parts: SessionParts = {}): Session {
	const segments = parts.segments ?? [
		segment('seg_src1', 'The clerk types every booking into the PMS by hand.'),
		segment('seg_src2', 'Then housekeeping retype the list into their sheet.'),
	];
	const steps =
		parts.steps
		?? [
			step(
				'step_1',
				inferredTextClaim(
					'Type booking',
					[evidence('seg_src1', 1, 'types every booking into the PMS')],
				),
			),
			step(
				'step_2',
				inferredTextClaim(
					'Retype list',
					[evidence('seg_src2', 1, 'housekeeping retype the list')],
				),
			),
		];
	const firstStepId = steps[0]?.id ?? null;
	const edges =
		parts.edges
		?? [
			edge('edge_1', 'step_1', 'step_2', [
				evidence('seg_src2', 1, 'Then housekeeping retype'),
			]),
		];
	const questions =
		parts.questions ?? [question('q_1', firstStepId, 'tool')];
	const opportunities =
		parts.opportunities
		?? (firstStepId
			? [
				opportunity('opp_1', [firstStepId], [
					evidence('seg_src1', 1, 'types every booking into the PMS'),
				]),
			]
			: []);
	const session = SessionSchema.parse({
		id: parts.id ?? 'ses_t1',
		clientId: parts.clientId ?? 'cli_t1',
		title: parts.title ?? 'Test session',
		rev: parts.rev ?? 1,
		origin: parts.origin ?? 'user',
		transcript: TranscriptSchema.parse({ source: 'paste', segments }),
		workflow: { steps, edges },
		questions,
		opportunities,
		proposals: parts.proposals ?? [],
		discovery: parts.discovery === undefined ? null : parts.discovery,
		reviewNotices: parts.reviewNotices ?? [],
	});
	return session;
}
