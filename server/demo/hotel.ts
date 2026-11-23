// Fictional hotel demo fixture contract: a checked-in seed (client + pasted
// interview transcript) and a canned fixture provider. The provider answers
// only for the recognized seed session and its two approved source variants:
//
// - `hotel-demo-base-v1`: the unmodified seed transcript, no saved answers.
// - `hotel-demo-followup-v1`: the same transcript plus exactly the documented
//   follow-up answer recorded on `q_hotel_01` (in `hotel-payloads.ts`). The
//   variant is bound to the answer as the session actually persists it — the
//   real server-assigned answer id and revision — never to a canned fake id.
//
// Binding is checked against persisted ids plus a transcript fingerprint,
// never against dynamic answer ids invented here; the payload data file
// verifies every quoted evidence string verbatim at module load.
import {
	CANNED_ASSESSMENT,
	CANNED_EXTRACTION,
	CANNED_PROPOSAL,
	HOTEL_DEMO_FOLLOWUP_ANSWER,
	buildFollowupAssessment,
	buildFollowupExtraction,
	buildFollowupProposal,
	seedTranscript,
} from './hotel-payloads';
import type { Client, Id, Session, Transcript } from '../../shared/p0/types';
import {
	ExtractInputSchema,
	ProposeInputSchema,
	StageError,
} from '../../shared/p0/stages';
import type { AnalysisProvider } from '../analysis/provider';
import { createHash } from 'node:crypto';

// Re-exported for existing importers (tests, smoke): the payload data lives in
// `hotel-payloads.ts`; the public demo surface stays here.
export {
	CANNED_ASSESSMENT,
	CANNED_EXTRACTION,
	CANNED_PROPOSAL,
	HOTEL_DEMO_FOLLOWUP_ANSWER,
} from './hotel-payloads';

export const HOTEL_FIXTURE_VARIANT = 'hotel-demo-base-v1';
export const HOTEL_FOLLOWUP_VARIANT = 'hotel-demo-followup-v1';

export const HOTEL_DEMO_CLIENT_ID = 'cli_hotel_demo';
export const HOTEL_DEMO_SESSION_ID = 'ses_hotel_demo';

/** The only question the base discovery asks, and the one the follow-up answers. */
export const HOTEL_DEMO_FOLLOWUP_QUESTION_ID = 'q_hotel_01';

const DEMO_CLIENT: Client = {
	id: HOTEL_DEMO_CLIENT_ID,
	name: 'Hotel Yuki Sapporo (fictional demo client)',
};

/** The seed session: rev 1, empty collections, no discovery artifacts yet. */
export const hotelSeed: { client: Client; session: Session } = {
	client: DEMO_CLIENT,
	session: {
		id: HOTEL_DEMO_SESSION_ID,
		clientId: HOTEL_DEMO_CLIENT_ID,
		title: 'Front desk reservations interview, Hotel Yuki Sapporo (fictional fixture demo)',
		rev: 1,
		origin: 'hotel-demo',
		transcript: seedTranscript,
		workflow: { steps: [], edges: [] },
		questions: [],
		opportunities: [],
		proposals: [],
		discovery: null,
		reviewNotices: [],
	},
};

// ---------------------------------------------------------------------------
// Fixture binding
// ---------------------------------------------------------------------------

function transcriptFingerprint(transcript: Transcript): string {
	return createHash('sha256')
		.update(
			JSON.stringify(
				transcript.segments.map((segment) => ({
					id: segment.id,
					sourceRev: segment.sourceRev,
					speaker: segment.speaker,
					text: segment.text,
					startMs: segment.startMs,
					endMs: segment.endMs,
				})),
			),
		)
		.digest('hex');
}

const SEED_FINGERPRINT = transcriptFingerprint(seedTranscript);

/**
 * Which approved variant the session is actually in, decided from the
 * persisted questions. The follow-up state keeps the real persisted answer id
 * and revision so every answer-backed citation binds to that exact record.
 */
type FixtureBinding = {
	variant: typeof HOTEL_FIXTURE_VARIANT | typeof HOTEL_FOLLOWUP_VARIANT;
	answer: { id: Id; sourceRev: number } | null;
};

function resolveBinding(session: Session): FixtureBinding {
	const answeredQuestions = session.questions.filter(
		(question) => question.answer !== null,
	);
	if (answeredQuestions.length === 0) {
		return { variant: HOTEL_FIXTURE_VARIANT, answer: null };
	}
	if (answeredQuestions.length > 1) {
		throw new StageError(
			'fixture_unsupported',
			'The fixture covers only the single documented follow-up answer on question q_hotel_01.',
		);
	}
	const answeredQuestion = answeredQuestions[0];
	const answer = answeredQuestion?.answer ?? null;
	if (
		!answeredQuestion
		|| answer === null
		|| answeredQuestion.id !== HOTEL_DEMO_FOLLOWUP_QUESTION_ID
		|| answeredQuestion.factKey !== 'frequency'
		|| answeredQuestion.targetStepId !== 'step_hotel_07'
		|| answeredQuestion.status !== 'answered'
	) {
		throw new StageError(
			'fixture_unsupported',
			'The persisted answer is not the documented follow-up on question q_hotel_01.',
		);
	}
	if (answer.text !== HOTEL_DEMO_FOLLOWUP_ANSWER) {
		throw new StageError(
			'fixture_unsupported',
			'The persisted answer text does not match the documented follow-up answer; the fixture covers only the documented wording.',
		);
	}
	return {
		variant: HOTEL_FOLLOWUP_VARIANT,
		answer: { id: answer.id, sourceRev: answer.sourceRev },
	};
}

function assertBinding(
	input: {
		variant: string;
		clientId: string;
		sessionId: string;
		transcript?: Transcript;
		answers?: unknown[];
	},
	binding: FixtureBinding,
): void {
	if (input.variant !== binding.variant) {
		throw new StageError(
			'fixture_unsupported',
			`Fixture provider answers only for variant '${binding.variant}'.`,
		);
	}
	if (
		input.clientId !== HOTEL_DEMO_CLIENT_ID
		|| input.sessionId !== HOTEL_DEMO_SESSION_ID
	) {
		throw new StageError(
			'fixture_unsupported',
			'Fixture provider only answers for the seeded demo session.',
		);
	}
	if (input.answers !== undefined) {
		assertProjectedAnswers(input.answers, binding);
	}
	if (
		input.transcript
		&& transcriptFingerprint(input.transcript) !== SEED_FINGERPRINT
	) {
		throw new StageError(
			'fixture_unsupported',
			'The transcript no longer matches the approved fixture variant.',
		);
	}
}

/**
 * The projected answers must corroborate the binding decided from the
 * persisted session: none for the base variant, exactly the documented
 * follow-up answer for the follow-up variant.
 */
function assertProjectedAnswers(
	answers: unknown[],
	binding: FixtureBinding,
): void {
	if (binding.variant === HOTEL_FIXTURE_VARIANT) {
		if (answers.length > 0) {
			throw new StageError(
				'fixture_unsupported',
				'The base fixture variant does not cover answered sessions; the documented follow-up variant does.',
			);
		}
		return;
	}
	if (answers.length !== 1) {
		throw new StageError(
			'fixture_unsupported',
			'The follow-up fixture requires exactly the documented answer on q_hotel_01.',
		);
	}
	const answer = answers[0] as {
		questionId?: string;
		factKey?: string;
		targetStepId?: string;
		text?: string;
	};
	if (
		answer.questionId !== HOTEL_DEMO_FOLLOWUP_QUESTION_ID
		|| answer.factKey !== 'frequency'
		|| answer.targetStepId !== 'step_hotel_07'
		|| answer.text !== HOTEL_DEMO_FOLLOWUP_ANSWER
	) {
		throw new StageError(
			'fixture_unsupported',
			'The projected answers do not match the documented follow-up variant.',
		);
	}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Build the fixture provider for one session. The approved variant is decided
 * from the session's persisted state: the unmodified seed transcript with no
 * answers, or the seed transcript plus exactly the documented follow-up answer
 * recorded on q_hotel_01 (bound to its real persisted id and revision). It
 * refuses anything else, so fixture runs can never impersonate analysis for
 * user sessions, edited sources, or answers outside the documented variant.
 */
export function createHotelFixtureProvider(session: Session): AnalysisProvider {
	if (
		session.id !== HOTEL_DEMO_SESSION_ID
		|| session.clientId !== HOTEL_DEMO_CLIENT_ID
	) {
		throw new StageError(
			'fixture_unsupported',
			'Fixture provider only supports the seeded demo session.',
		);
	}
	const binding = resolveBinding(session);
	return {
		mode: 'fixture',
		key: binding.variant,
		async run(operation, input) {
			if (operation === 'extract') {
				const projected = ExtractInputSchema.parse(input);
				assertBinding(projected, binding);
				return binding.answer === null ?
						CANNED_EXTRACTION
					:	buildFollowupExtraction(binding.answer);
			}
			if (operation === 'assess') {
				const projected = input as {
					variant?: string;
					clientId?: string;
					sessionId?: string;
				};
				assertBinding(
					{
						variant: projected.variant ?? '',
						clientId: projected.clientId ?? '',
						sessionId: projected.sessionId ?? '',
					},
					binding,
				);
				return binding.answer === null ?
						CANNED_ASSESSMENT
					:	buildFollowupAssessment();
			}
			if (operation === 'propose') {
				const projected = ProposeInputSchema.parse(input);
				assertBinding(projected, binding);
				if (projected.opportunity.id === 'opp_hotel_01') {
					return CANNED_PROPOSAL;
				}
				if (
					binding.answer !== null
					&& projected.opportunity.id === 'opp_hotel_02'
				) {
					return buildFollowupProposal(binding.answer);
				}
				throw new StageError(
					'fixture_unsupported',
					`The ${binding.variant} fixture does not propose for opportunity '${projected.opportunity.id}'.`,
				);
			}
			throw new StageError(
				'fixture_unsupported',
				`Unknown fixture stage '${operation}'.`,
			);
		},
	};
}
