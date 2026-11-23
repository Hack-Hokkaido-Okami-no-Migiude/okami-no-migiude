// Shared builders for analysis tests: a small deterministic session with a
// three-segment transcript, extraction/assessment templates, and a scripted
// stub provider (no external calls). Kept out of the `*.test.ts` pattern so
// the test runner never executes it directly.
import type {
	AssessOutput,
	EvidenceCandidate,
	ExtractOutput,
	ProposeOutput,
} from '../../shared/p0/stages';
import type { EvidenceRef, Session, Step } from '../../shared/p0/types';
import type { AnalysisProvider } from '../../server/analysis/provider';

export const SEGMENT_TEXTS = {
	seg_a: 'The clerk receives the reservation email and reads the details.',
	seg_b: 'After reading the email, the clerk types the booking into the PMS.',
	seg_c: 'Clerks use the PMS all day, and housekeeping keeps the schedule sheet in Excel.',
} as const;

export function baseSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'ses_test',
		clientId: 'cli_test',
		title: 'Analysis test session',
		rev: 1,
		origin: 'user',
		transcript: {
			source: 'paste',
			segments: Object.entries(SEGMENT_TEXTS).map(
				([id, text], index) => ({
					id,
					sourceRev: 1,
					speaker: index % 2 === 0 ? 'Sato' : 'Kudo',
					text,
					startMs: null,
					endMs: null,
				}),
			),
		},
		workflow: { steps: [], edges: [] },
		questions: [],
		opportunities: [],
		proposals: [],
		discovery: null,
		reviewNotices: [],
		...overrides,
	};
}

export function evidence(sourceId: string, quote: string): EvidenceCandidate {
	return { sourceId, sourceRev: 1, quote };
}

export function evidenceRef(sourceId: string, quote: string): EvidenceRef {
	return { sourceId, sourceRev: 1, quote };
}

export function baseExtraction(
	overrides: Partial<ExtractOutput> = {},
): ExtractOutput {
	return {
		steps: [
			{
				key: 'step_a',
				label: 'Receive reservation email',
				role: 'Front desk clerk',
				tool: 'Email inbox',
				execution: 'manual',
				evidence: [evidence('seg_a', 'receives the reservation email')],
				anchors: ['receives the reservation email'],
			},
			{
				key: 'step_b',
				label: 'Enter booking into the PMS',
				role: 'Front desk clerk',
				tool: 'PMS',
				execution: 'manual',
				evidence: [evidence('seg_b', 'types the booking into the PMS')],
				anchors: ['types the booking into the PMS'],
			},
		],
		transitions: [
			{
				key: 'edge_ab',
				fromKey: 'step_a',
				toKey: 'step_b',
				kind: 'sequence',
				condition: null,
				evidence: evidence(
					'seg_b',
					'After reading the email, the clerk types the booking into the PMS',
				),
				fromAnchor: 'reading the email',
				toAnchor: 'types the booking into the PMS',
			},
		],
		unknowns: [
			{
				key: 'q_a',
				stepKey: 'step_a',
				factKey: 'frequency',
				prompt: 'How many reservation emails arrive per day?',
				whyItMatters: 'Volume drives the automation case.',
				priority: 'high',
			},
		],
		opportunities: [
			{
				key: 'opp_x',
				title: 'Auto-enter bookings into the PMS',
				strategy: 'integration',
				stepKeys: ['step_a', 'step_b'],
				rationale:
					'Booking emails are structured, so entry can be automated.',
				evidence: [evidence('seg_b', 'types the booking into the PMS')],
				benefits: ['Saves clerk time'],
				prerequisites: ['Feed access'],
				risks: ['Wrong automated entries'],
				unknowns: ['Feed format'],
				factors: [
					{
						factor: 'impact',
						level: 'high',
						evidence: evidence(
							'seg_b',
							'types the booking into the PMS',
						),
					},
					{
						factor: 'effort',
						level: 'low',
						evidence: evidence(
							'seg_b',
							'types the booking into the PMS',
						),
					},
				],
				assumptions: [
					{
						which: 'monthlyOccurrences',
						value: 100,
						basis: 'Rough volume estimate.',
						evidence: evidence(
							'seg_a',
							'receives the reservation email',
						),
					},
					{
						which: 'minutesSaved',
						value: 6,
						basis: 'Minutes per entry estimate.',
						evidence: evidence(
							'seg_b',
							'types the booking into the PMS',
						),
					},
				],
			},
		],
		...overrides,
	};
}

export function baseAssessment(
	overrides: Partial<AssessOutput> = {},
): AssessOutput {
	return {
		acceptedTransitionKeys: ['edge_ab'],
		rejected: [],
		notices: [],
		...overrides,
	};
}

export function baseProposalOutput(
	overrides: Partial<ProposeOutput> = {},
): ProposeOutput {
	return {
		planKey: 'plan_test_01',
		steps: [
			{
				key: 'pstep_new',
				label: 'Create the PMS booking automatically from the email',
				currentStepIds: ['step_b'],
				evidence: [evidence('seg_b', 'types the booking into the PMS')],
			},
		],
		edges: [],
		planSections: {
			scope: 'Automate booking entry.',
			businessRules: 'Only structured emails are automated.',
			integrationsAuth: 'Server-side service account.',
			exceptions: 'Free-text emails stay manual.',
			humanOversight: 'Clerk reviews flagged entries.',
			milestones: '1) Pilot. 2) Review. 3) Cut over.',
			acceptanceTests: 'Twenty sample emails match.',
		},
		...overrides,
	};
}

export type StubStages = Partial<
	Record<'extract' | 'assess' | 'propose', (input: unknown) => unknown>
>;

/** A scripted provider: each stage returns the given value; missing stages fail. */
export function stubProvider(
	stages: StubStages,
	options: {
		mode?: 'fixture' | 'live';
		key?: string;
		onCall?: (operation: string, input: unknown) => void;
	} = {},
): AnalysisProvider {
	return {
		mode: options.mode ?? 'live',
		key: options.key ?? 'stub-v1',
		async run(operation, input) {
			options.onCall?.(operation, input);
			const handler = stages[operation as keyof StubStages];
			if (!handler) {
				throw new Error(
					`Unexpected stage '${operation}' for this stub.`,
				);
			}
			return handler(input);
		},
	};
}

/** A consultant-verified string claim for preservation tests. */
export function verifiedClaim(value: string, evidenceRefs: EvidenceRef[]) {
	return {
		value,
		state: 'consultant-verified',
		author: 'consultant',
		evidence: evidenceRefs,
	} as Step['label'];
}
