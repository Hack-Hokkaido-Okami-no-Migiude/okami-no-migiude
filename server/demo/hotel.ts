// Fictional hotel demo fixture: a checked-in seed (client + pasted interview
// transcript) and a canned fixture provider. The provider only answers for the
// recognized seed session and its approved source variant — binding is checked
// against persisted ids plus a transcript fingerprint, never against dynamic
// answers. All quoted evidence below must be verbatim substrings of the seed
// transcript, verified once at module load.
import type {
	AssessOutput,
	EvidenceCandidate,
	ExtractOutput,
	ProposeOutput,
} from '../../shared/p0/stages';
import type { Client, Session, Transcript } from '../../shared/p0/types';
import {
	ExtractInputSchema,
	ProposeInputSchema,
	StageError,
} from '../../shared/p0/stages';
import type { AnalysisProvider } from '../analysis/provider';
import { createHash } from 'node:crypto';

export const HOTEL_FIXTURE_VARIANT = 'hotel-demo-base-v1';

export const HOTEL_DEMO_CLIENT_ID = 'cli_hotel_demo';
export const HOTEL_DEMO_SESSION_ID = 'ses_hotel_demo';

const DEMO_CLIENT: Client = {
	id: HOTEL_DEMO_CLIENT_ID,
	name: 'Hotel Yuki Sapporo (fictional demo client)',
};

// ---------------------------------------------------------------------------
// Seed transcript (paste source, original wording preserved verbatim)
// ---------------------------------------------------------------------------

const SEGMENTS: { id: string; speaker: string | null; text: string }[] = [
	{
		id: 'seg_hotel_01',
		speaker: 'Sato (Front Desk Lead)',
		text: 'Reservations arrive in three ways: the booking engine, direct email, and phone calls. About 70 percent come through the booking engine, which drops a notification email into the reservations inbox.',
	},
	{
		id: 'seg_hotel_02',
		speaker: 'Sato (Front Desk Lead)',
		text: 'For every email, one of the clerks reads the details, like guest name, dates, room type, and any special requests, and types them into YukiReserve, our property management system. When the availability matches, they click reserve and note the confirmation number in the email thread.',
	},
	{
		id: 'seg_hotel_03',
		speaker: 'Kudo (Front Desk Clerk)',
		text: 'During high season I enter about 40 emails a day like this. It takes me roughly 4 minutes per email, and I have to be careful because the booking engine emails are all formatted the same but direct emails are free text.',
	},
	{
		id: 'seg_hotel_04',
		speaker: 'Sato (Front Desk Lead)',
		text: 'Once the reservation is saved in YukiReserve, the system marks the room as booked immediately. There is no export from YukiReserve to anything else, so every morning at 7:30 the night clerk prints the arrivals list from YukiReserve and walks it over to the housekeeping desk.',
	},
	{
		id: 'seg_hotel_05',
		speaker: 'Kudo (Front Desk Clerk)',
		text: 'Right, the morning arrivals list. YukiReserve can only print it, so housekeeping gets a paper list. They then retype the arrivals into their own cleaning schedule sheet in Excel. It happens every morning, 7 days a week.',
	},
	{
		id: 'seg_hotel_06',
		speaker: 'Sato (Front Desk Lead)',
		text: 'If the booking engine sends a modification email, the clerk has to find the original booking in YukiReserve and change the dates by hand. Last month we double-booked two rooms because a modification email arrived while the clerk was on another call.',
	},
	{
		id: 'seg_hotel_07',
		speaker: 'Sato (Front Desk Lead)',
		text: 'Cancellation emails are handled the same way, by hand. When two emails arrive at the same time for the same room, the clerk decides which one to keep, so there is no automatic check.',
	},
	{
		id: 'seg_hotel_08',
		speaker: 'Sato (Front Desk Lead)',
		text: 'Clerks use YukiReserve all day, and housekeeping keeps their cleaning schedule sheet in Excel on the shared drive.',
	},
	{
		id: 'seg_hotel_09',
		speaker: 'Kudo (Front Desk Clerk)',
		text: 'The system sends the guest a confirmation automatically once the booking is saved in YukiReserve. After that, if anything changes we edit the booking and the guest gets an updated confirmation.',
	},
];

const seedTranscript: Transcript = {
	source: 'paste',
	segments: SEGMENTS.map((segment) => ({
		id: segment.id,
		sourceRev: 1,
		speaker: segment.speaker,
		text: segment.text,
		startMs: null,
		endMs: null,
	})),
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

function assertBinding(input: {
	variant: string;
	clientId: string;
	sessionId: string;
	transcript?: Transcript;
	answers?: unknown[];
}): void {
	if (input.variant !== HOTEL_FIXTURE_VARIANT) {
		throw new StageError(
			'fixture_unsupported',
			'Fixture provider only answers for the hotel demo variant.',
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
	if (input.answers && input.answers.length > 0) {
		throw new StageError(
			'fixture_unsupported',
			'The base fixture variant does not cover answered sessions; documented follow-up variants only.',
		);
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

// ---------------------------------------------------------------------------
// Canned extraction (local candidate keys become the fixed fixture ids)
// ---------------------------------------------------------------------------

function quoteOf(segmentId: string, quote: string): EvidenceCandidate {
	const segment = SEGMENTS.find((entry) => entry.id === segmentId);
	if (!segment) {
		throw new Error(
			`Fixture quotes reference unknown segment '${segmentId}'.`,
		);
	}
	if (!segment.text.includes(quote)) {
		throw new Error(
			`Fixture quote for '${segmentId}' is not a verbatim substring.`,
		);
	}
	return { sourceId: segmentId, sourceRev: 1, quote };
}

const CANNED_EXTRACTION: ExtractOutput = {
	steps: [
		{
			key: 'step_hotel_01',
			label: 'Receive reservation email',
			role: 'Front desk clerk',
			tool: 'Reservations inbox',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_01',
					'Reservations arrive in three ways: the booking engine, direct email, and phone calls',
				),
			],
			anchors: [
				'Reservations arrive in three ways',
				'notification email into the reservations inbox',
			],
		},
		{
			key: 'step_hotel_02',
			label: 'Enter reservation into YukiReserve',
			role: 'Front desk clerk',
			tool: 'YukiReserve (property management system)',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_02',
					'types them into YukiReserve, our property management system',
				),
			],
			anchors: [
				'types them into YukiReserve',
				'enter about 40 emails a day',
			],
		},
		{
			key: 'step_hotel_03',
			label: 'Send guest confirmation',
			role: 'YukiReserve system',
			tool: 'YukiReserve (property management system)',
			execution: 'automated',
			evidence: [
				quoteOf(
					'seg_hotel_09',
					'The system sends the guest a confirmation automatically once the booking is saved in YukiReserve',
				),
			],
			anchors: [
				'sends the guest a confirmation automatically',
				'note the confirmation number in the email thread',
			],
		},
		{
			key: 'step_hotel_04',
			label: 'Print daily arrivals list',
			role: 'Night clerk',
			tool: 'YukiReserve (property management system)',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_04',
					'every morning at 7:30 the night clerk prints the arrivals list from YukiReserve',
				),
			],
			anchors: [
				'prints the arrivals list from YukiReserve',
				'the morning arrivals list',
			],
		},
		{
			key: 'step_hotel_05',
			label: 'Deliver arrivals list to housekeeping',
			role: 'Night clerk',
			tool: 'Paper arrivals list',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_04',
					'walks it over to the housekeeping desk',
				),
			],
			anchors: [
				'walks it over to the housekeeping desk',
				'housekeeping gets a paper list',
			],
		},
		{
			key: 'step_hotel_06',
			label: 'Retype arrivals into cleaning schedule',
			role: 'Housekeeping staff',
			tool: 'Excel cleaning schedule sheet',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_05',
					'retype the arrivals into their own cleaning schedule sheet in Excel',
				),
			],
			anchors: [
				'retype the arrivals into their own cleaning schedule sheet in Excel',
			],
		},
		{
			key: 'step_hotel_07',
			label: 'Update booking for modification email',
			role: 'Front desk clerk',
			tool: 'YukiReserve (property management system)',
			execution: 'manual',
			evidence: [
				quoteOf(
					'seg_hotel_06',
					'find the original booking in YukiReserve and change the dates by hand',
				),
			],
			anchors: [
				'find the original booking in YukiReserve and change the dates by hand',
			],
		},
	],
	transitions: [
		{
			key: 'edge_hotel_01',
			fromKey: 'step_hotel_01',
			toKey: 'step_hotel_02',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_02',
				'For every email, one of the clerks reads the details, like guest name, dates, room type, and any special requests, and types them into YukiReserve',
			),
			fromAnchor: 'For every email',
			toAnchor: 'types them into YukiReserve',
		},
		{
			key: 'edge_hotel_02',
			fromKey: 'step_hotel_02',
			toKey: 'step_hotel_03',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_09',
				'The system sends the guest a confirmation automatically once the booking is saved in YukiReserve',
			),
			fromAnchor: 'the booking is saved in YukiReserve',
			toAnchor: 'sends the guest a confirmation automatically',
		},
		{
			key: 'edge_hotel_03',
			fromKey: 'step_hotel_02',
			toKey: 'step_hotel_04',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_04',
				'every morning at 7:30 the night clerk prints the arrivals list from YukiReserve',
			),
			fromAnchor: 'from YukiReserve',
			toAnchor: 'prints the arrivals list',
		},
		{
			key: 'edge_hotel_04',
			fromKey: 'step_hotel_04',
			toKey: 'step_hotel_05',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_04',
				'prints the arrivals list from YukiReserve and walks it over to the housekeeping desk',
			),
			fromAnchor: 'prints the arrivals list',
			toAnchor: 'walks it over to the housekeeping desk',
		},
		{
			key: 'edge_hotel_05',
			fromKey: 'step_hotel_05',
			toKey: 'step_hotel_06',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_05',
				'housekeeping gets a paper list. They then retype the arrivals into their own cleaning schedule sheet in Excel',
			),
			fromAnchor: 'housekeeping gets a paper list',
			toAnchor:
				'retype the arrivals into their own cleaning schedule sheet in Excel',
		},
		{
			key: 'edge_hotel_06',
			fromKey: 'step_hotel_01',
			toKey: 'step_hotel_07',
			kind: 'exception',
			condition: 'A modification email arrives from the booking engine',
			evidence: quoteOf(
				'seg_hotel_06',
				'If the booking engine sends a modification email, the clerk has to find the original booking in YukiReserve and change the dates by hand',
			),
			fromAnchor: 'the booking engine sends a modification email',
			toAnchor: 'find the original booking in YukiReserve',
		},
		{
			// Authentic quote mentioning both endpoints with no transition phrase:
			// the assessment must reject it and the graph must not contain the edge.
			key: 'edge_hotel_reject_cooccur',
			fromKey: 'step_hotel_02',
			toKey: 'step_hotel_06',
			kind: 'sequence',
			condition: null,
			evidence: quoteOf(
				'seg_hotel_08',
				'Clerks use YukiReserve all day, and housekeeping keeps their cleaning schedule sheet in Excel on the shared drive',
			),
			fromAnchor: 'YukiReserve',
			toAnchor: 'cleaning schedule sheet in Excel',
		},
	],
	unknowns: [
		{
			key: 'q_hotel_01',
			stepKey: 'step_hotel_07',
			factKey: 'frequency',
			prompt: 'On average, how many booking-engine modification emails arrive per day?',
			whyItMatters:
				'Sets the volume of manual date edits and the double-booking risk; a large volume strengthens the case for automation.',
			priority: 'high',
		},
	],
	opportunities: [
		{
			key: 'opp_hotel_01',
			title: 'Auto-enter booking engine reservations into YukiReserve',
			strategy: 'integration',
			stepKeys: ['step_hotel_01', 'step_hotel_02'],
			rationale:
				'Booking engine emails arrive in a consistent format, so an integration can create the YukiReserve reservation directly and free roughly 4 minutes of clerk time per email.',
			evidence: [
				quoteOf(
					'seg_hotel_02',
					'For every email, one of the clerks reads the details, like guest name, dates, room type, and any special requests, and types them into YukiReserve',
				),
			],
			benefits: [
				'Removes manual re-entry of booking engine emails',
				'Frees roughly 2.7 hours of clerk time per day in high season',
				'Reduces missed modification emails and double-bookings',
			],
			prerequisites: [
				'Access to the booking engine notification feed',
				'YukiReserve reservation API or supported import format',
			],
			risks: [
				'Direct free-text emails still need clerk handling',
				'Incorrect automated entries could create wrong bookings',
			],
			unknowns: [
				'Exact booking engine integration interface',
				'How modification emails should be applied',
			],
			factors: [
				{
					factor: 'impact',
					level: 'high',
					evidence: quoteOf(
						'seg_hotel_06',
						'Last month we double-booked two rooms because a modification email arrived while the clerk was on another call',
					),
				},
				{
					factor: 'frequency',
					level: 'high',
					evidence: quoteOf(
						'seg_hotel_03',
						'I enter about 40 emails a day like this',
					),
				},
				{
					factor: 'effort',
					level: 'medium',
					evidence: quoteOf(
						'seg_hotel_02',
						'types them into YukiReserve, our property management system',
					),
				},
				{
					factor: 'feasibility',
					level: 'high',
					evidence: quoteOf(
						'seg_hotel_03',
						'the booking engine emails are all formatted the same',
					),
				},
				{
					factor: 'risk',
					level: 'low',
					evidence: quoteOf(
						'seg_hotel_09',
						'The system sends the guest a confirmation automatically once the booking is saved in YukiReserve',
					),
				},
			],
			assumptions: [
				{
					which: 'monthlyOccurrences',
					value: 1200,
					basis: 'About 40 booking engine emails per day in high season (Kudo), across roughly 30 days per month.',
					evidence: quoteOf(
						'seg_hotel_03',
						'I enter about 40 emails a day like this',
					),
				},
				{
					which: 'minutesSaved',
					value: 4,
					basis: 'Roughly 4 minutes of clerk time per email (Kudo).',
					evidence: quoteOf(
						'seg_hotel_03',
						'roughly 4 minutes per email',
					),
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Canned assessment and proposal
// ---------------------------------------------------------------------------

const REJECTED_COOCCURRENCE_DETAIL =
	'the cited quote mentions both steps but contains no explicit trigger, handoff, or sequence phrase';

const CANNED_ASSESSMENT: AssessOutput = {
	acceptedTransitionKeys: [
		'edge_hotel_01',
		'edge_hotel_02',
		'edge_hotel_03',
		'edge_hotel_04',
		'edge_hotel_05',
		'edge_hotel_06',
	],
	rejected: [
		{
			key: 'edge_hotel_reject_cooccur',
			reason: 'no_transition_phrase',
			detail: `${REJECTED_COOCCURRENCE_DETAIL}.`,
		},
	],
	notices: [
		{
			code: 'ambiguous_match',
			targetId: null,
			message: `Candidate transition between 'Enter reservation into YukiReserve' and 'Retype arrivals into cleaning schedule' was omitted: ${REJECTED_COOCCURRENCE_DETAIL}.`,
		},
	],
};

const CANNED_PROPOSAL: ProposeOutput = {
	planKey: 'plan_hotel_01',
	steps: [
		{
			key: 'pstep_hotel_01',
			label: 'Create the YukiReserve reservation automatically from the booking engine email',
			currentStepIds: ['step_hotel_02'],
			evidence: [
				quoteOf(
					'seg_hotel_02',
					'For every email, one of the clerks reads the details, like guest name, dates, room type, and any special requests, and types them into YukiReserve',
				),
				quoteOf(
					'seg_hotel_03',
					'I enter about 40 emails a day like this',
				),
			],
		},
		{
			key: 'pstep_hotel_02',
			label: 'Flag mismatched or conflicting reservation emails for clerk review',
			currentStepIds: ['step_hotel_01'],
			evidence: [
				quoteOf(
					'seg_hotel_07',
					'When two emails arrive at the same time for the same room, the clerk decides which one to keep, so there is no automatic check',
				),
			],
		},
	],
	edges: [
		{
			key: 'pedge_hotel_01',
			fromKey: 'pstep_hotel_01',
			toKey: 'pstep_hotel_02',
			label: 'Reservations that fail validation route to clerk review',
			evidence: [
				quoteOf(
					'seg_hotel_07',
					'When two emails arrive at the same time for the same room, the clerk decides which one to keep, so there is no automatic check',
				),
			],
		},
	],
	planSections: {
		scope: 'Replace manual entry of booking engine reservation emails into YukiReserve with an automated integration; clerks keep handling direct and phone bookings.',
		businessRules:
			'Create the reservation only when the parsed room type and dates match available inventory; otherwise flag it for clerk review instead of saving.',
		integrationsAuth:
			'Read-only access to the booking engine notification feed and a dedicated service account for YukiReserve reservation creation; credentials stay server-side.',
		exceptions:
			'Modification and cancellation emails remain clerk-handled; conflicting emails for the same room open a review queue instead of saving automatically.',
		humanOversight:
			'A clerk reviews every automated entry flagged for mismatch before the guest confirmation is sent.',
		milestones:
			'1) Pilot the feed with test bookings. 2) Review the match rate with clerks. 3) Cut over during low season.',
		acceptanceTests:
			'For 20 sample booking engine emails, the created YukiReserve reservation matches guest name, dates, and room type; mismatches queue for review and never save automatically.',
	},
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Build the fixture provider for one session. It refuses anything but the
 * approved seed session and its unmodified base transcript variant, so fixture
 * runs can never impersonate analysis for user sessions or edited sources.
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
	return {
		mode: 'fixture',
		key: HOTEL_FIXTURE_VARIANT,
		async run(operation, input) {
			if (operation === 'extract') {
				const projected = ExtractInputSchema.parse(input);
				assertBinding(projected);
				return CANNED_EXTRACTION;
			}
			if (operation === 'assess') {
				const projected = input as {
					variant?: string;
					clientId?: string;
					sessionId?: string;
				};
				assertBinding({
					variant: projected.variant ?? '',
					clientId: projected.clientId ?? '',
					sessionId: projected.sessionId ?? '',
				});
				return CANNED_ASSESSMENT;
			}
			if (operation === 'propose') {
				const projected = ProposeInputSchema.parse(input);
				assertBinding(projected);
				if (projected.opportunity.id !== 'opp_hotel_01') {
					throw new StageError(
						'fixture_unsupported',
						`The fixture only proposes for opportunity 'opp_hotel_01', not '${projected.opportunity.id}'.`,
					);
				}
				return CANNED_PROPOSAL;
			}
			throw new StageError(
				'fixture_unsupported',
				`Unknown fixture stage '${operation}'.`,
			);
		},
	};
}
