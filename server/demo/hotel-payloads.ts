// Fictional hotel demo fixture data: the seed interview transcript, the
// documented follow-up answer, and the canned stage payloads for the two
// approved source variants (`hotel-demo-base-v1` constants plus per-answer
// follow-up builders). Pure data; the binding/provider contract lives in
// `hotel.ts`. Every quoted evidence string here is a verbatim substring of the
// seed transcript or of the documented answer, verified once at module load.
import type {
	AssessOutput,
	EvidenceCandidate,
	ExtractOutput,
	ProposeOutput,
} from '../../shared/p0/stages';
import type { Id, Transcript } from '../../shared/p0/types';

/**
 * The documented follow-up answer (Hotel Yuki interview, a call-back with Sato
 * recorded by the consultant). The fixture follow-up variant accepts exactly
 * this wording, recorded on `q_hotel_01`; any other answer text is a different
 * source and unsupported.
 */
export const HOTEL_DEMO_FOLLOWUP_ANSWER =
	'Roughly two or three modification emails a day in high season, and maybe '
	+ 'one a day outside it; each one takes a couple of minutes to fix in '
	+ 'YukiReserve. The bigger headache is room changes. Whenever we change a '
	+ 'booking in YukiReserve — a modification email or a guest at the desk '
	+ 'asking to move rooms — if the room change happens after the 7:30 '
	+ 'arrivals list has gone over, we phone the housekeeping desk and Abe '
	+ 'rewrites the affected rows in the Excel schedule sheet by hand. I would '
	+ 'say we phone through about ten room changes a week in high season, and '
	+ 'each call plus the rewrite takes about a quarter of an hour. If we '
	+ 'forget to call, housekeeping sometimes cleans the wrong room first.';

// ---------------------------------------------------------------------------
// Seed transcript (paste source, original wording preserved verbatim).
// Hotel Yuki Sapporo: independent, twenty-eight rooms, twelve staff.
// ---------------------------------------------------------------------------

const SEGMENTS: { id: string; speaker: string | null; text: string }[] = [
	{
		id: 'seg_hotel_01',
		speaker: 'Sato (Front Desk Lead)',
		text:
			'Quick context before we start: Hotel Yuki is an independent hotel '
			+ 'near Susukino with twenty-eight rooms and twelve of us on staff — '
			+ 'four at the front desk, one night clerk, five in housekeeping, '
			+ 'our breakfast cook, and the manager. Reservations arrive in three '
			+ 'ways: the booking engine, direct email, and phone calls. About 70 '
			+ 'percent come through the booking engine, which drops a '
			+ 'notification email into the reservations inbox.',
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
		text:
			'Once the reservation is saved in YukiReserve, the system marks the '
			+ 'room as booked immediately. There is no export from YukiReserve '
			+ 'to anything else, so every morning at 7:30 the night clerk prints '
			+ 'the arrivals list from YukiReserve and walks it over to the '
			+ 'housekeeping desk. Our housekeeping lead, Abe, picks it up at the '
			+ 'housekeeping desk.',
	},
	{
		id: 'seg_hotel_05',
		speaker: 'Kudo (Front Desk Clerk)',
		text:
			'Right, the morning arrivals list. YukiReserve can only print it, '
			+ 'so housekeeping gets a paper list. They then retype the arrivals '
			+ 'into their own cleaning schedule sheet in Excel. It happens every '
			+ 'morning, 7 days a week. Abe, our housekeeping lead, decides the '
			+ 'cleaning order from that sheet. Anything that comes up later in '
			+ 'the day is handled some other way — that part never felt settled.',
	},
	{
		id: 'seg_hotel_06',
		speaker: 'Sato (Front Desk Lead)',
		text:
			'If the booking engine sends a modification email, the clerk has to '
			+ 'find the original booking in YukiReserve and change the dates by '
			+ 'hand. Last month we double-booked two rooms because a '
			+ 'modification email arrived while the clerk was on another call. '
			+ 'Guests who are already staying with us sometimes ask at the desk '
			+ 'to move to a different room, and we make that change in '
			+ 'YukiReserve the same way.',
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

export const seedTranscript: Transcript = {
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

// Answer-backed quotes, validated against the documented answer at module load.
// The persisted answer id is substituted when the follow-up outputs are built.
const FOLLOWUP_QUOTE_MODIFICATION_FREQUENCY =
	'Roughly two or three modification emails a day in high season';
const FOLLOWUP_QUOTE_BOOKING_CHANGE_TRIGGER =
	'Whenever we change a booking in YukiReserve — a modification email or a '
	+ 'guest at the desk asking to move rooms — if the room change happens '
	+ 'after the 7:30 arrivals list has gone over, we phone the housekeeping '
	+ 'desk';
const FOLLOWUP_QUOTE_PHONE_AND_REWRITE =
	'we phone the housekeeping desk and Abe rewrites the affected rows in the '
	+ 'Excel schedule sheet by hand';
const FOLLOWUP_QUOTE_WEEKLY_ROOM_CHANGES =
	'I would say we phone through about ten room changes a week in high season';
const FOLLOWUP_QUOTE_CALL_DURATION =
	'each call plus the rewrite takes about a quarter of an hour';
const FOLLOWUP_QUOTE_MISSED_CALLS =
	'If we forget to call, housekeeping sometimes cleans the wrong room first';

const FOLLOWUP_ANSWER_QUOTES = [
	FOLLOWUP_QUOTE_MODIFICATION_FREQUENCY,
	FOLLOWUP_QUOTE_BOOKING_CHANGE_TRIGGER,
	FOLLOWUP_QUOTE_PHONE_AND_REWRITE,
	FOLLOWUP_QUOTE_WEEKLY_ROOM_CHANGES,
	FOLLOWUP_QUOTE_CALL_DURATION,
	FOLLOWUP_QUOTE_MISSED_CALLS,
];

for (const quote of FOLLOWUP_ANSWER_QUOTES) {
	if (!HOTEL_DEMO_FOLLOWUP_ANSWER.includes(quote)) {
		throw new Error(
			`Fixture follow-up quote is not a verbatim substring of the documented answer: '${quote}'.`,
		);
	}
}

function answerQuoteOf(
	answer: { id: Id; sourceRev: number },
	quote: string,
): EvidenceCandidate {
	if (!HOTEL_DEMO_FOLLOWUP_ANSWER.includes(quote)) {
		throw new Error(
			`Fixture follow-up quote is not a verbatim substring of the documented answer: '${quote}'.`,
		);
	}
	return { sourceId: answer.id, sourceRev: answer.sourceRev, quote };
}

/** Base-variant stage payload; exported for the smoke live-provider stub. */
export const CANNED_EXTRACTION: ExtractOutput = {
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
// Canned follow-up extraction: the documented answer grounds one new step, one
// evidenced exception edge, and the deterministic housekeeping opportunity.
// ---------------------------------------------------------------------------

export function buildFollowupExtraction(answer: {
	id: Id;
	sourceRev: number;
}): ExtractOutput {
	return {
		steps: [
			...CANNED_EXTRACTION.steps,
			{
				key: 'step_hotel_08',
				label: 'Phone housekeeping about after-list room changes',
				role: 'Front desk clerk',
				tool: 'Housekeeping phone',
				execution: 'manual',
				evidence: [
					answerQuoteOf(answer, FOLLOWUP_QUOTE_PHONE_AND_REWRITE),
				],
				anchors: [
					'we phone the housekeeping desk',
					'Abe rewrites the affected rows in the Excel schedule sheet by hand',
				],
			},
		],
		transitions: [
			...CANNED_EXTRACTION.transitions,
			{
				key: 'edge_hotel_07',
				fromKey: 'step_hotel_07',
				toKey: 'step_hotel_08',
				kind: 'exception',
				condition:
					'The room change happens after the 7:30 arrivals list has gone to housekeeping',
				evidence: answerQuoteOf(
					answer,
					FOLLOWUP_QUOTE_BOOKING_CHANGE_TRIGGER,
				),
				fromAnchor: 'we change a booking in YukiReserve',
				toAnchor: 'we phone the housekeeping desk',
			},
		],
		// The answered frequency fact is suppressed on reanalysis; the
		// follow-up variant introduces no new actionable unknowns.
		unknowns: [],
		opportunities: [
			...CANNED_EXTRACTION.opportunities,
			{
				key: 'opp_hotel_02',
				title: 'Keep the housekeeping schedule current from confirmed room changes',
				strategy: 'rules',
				stepKeys: ['step_hotel_07', 'step_hotel_08'],
				rationale:
					'Confirmed room changes reach housekeeping only by phone call and a hand-rewritten schedule row, so a missed call leaves housekeeping cleaning the wrong room. A shared schedule that updates by a simple rule when a booking change is confirmed removes the phone relay; YukiReserve has no export, so this stays a rules-based feed rather than a deep integration.',
				evidence: [
					answerQuoteOf(
						answer,
						FOLLOWUP_QUOTE_BOOKING_CHANGE_TRIGGER,
					),
					quoteOf(
						'seg_hotel_04',
						'There is no export from YukiReserve to anything else',
					),
				],
				benefits: [
					'Housekeeping sees every confirmed room change without waiting for a phone call',
					'Removes the phone relay and the hand-rewritten schedule rows',
					'Avoids rooms being cleaned in the wrong order after a missed call',
				],
				prerequisites: [
					'A shared schedule location housekeeping already checks, such as the existing Excel sheet on the shared drive',
					'A rule or script that posts confirmed booking changes to that schedule',
				],
				risks: [
					'Posted changes must not overwrite cleaner assignments without the housekeeping lead confirming them',
					'YukiReserve has no export, so the rule needs a supported input such as the notifications inbox',
				],
				unknowns: [
					'Which shared location housekeeping will actually check during a shift',
				],
				factors: [
					{
						factor: 'impact',
						level: 'high',
						evidence: answerQuoteOf(
							answer,
							FOLLOWUP_QUOTE_MISSED_CALLS,
						),
					},
					{
						factor: 'frequency',
						level: 'medium',
						evidence: answerQuoteOf(
							answer,
							FOLLOWUP_QUOTE_WEEKLY_ROOM_CHANGES,
						),
					},
					{
						factor: 'effort',
						level: 'low',
						evidence: quoteOf(
							'seg_hotel_08',
							'housekeeping keeps their cleaning schedule sheet in Excel on the shared drive',
						),
					},
					{
						factor: 'feasibility',
						level: 'medium',
						evidence: quoteOf(
							'seg_hotel_04',
							'There is no export from YukiReserve to anything else',
						),
					},
					{
						factor: 'risk',
						level: 'medium',
						evidence: answerQuoteOf(
							answer,
							FOLLOWUP_QUOTE_PHONE_AND_REWRITE,
						),
					},
				],
				assumptions: [
					{
						which: 'monthlyOccurrences',
						value: 40,
						basis: 'About ten phone-through room changes per week in high season (consultant answer), across roughly four weeks.',
						evidence: answerQuoteOf(
							answer,
							FOLLOWUP_QUOTE_WEEKLY_ROOM_CHANGES,
						),
					},
					{
						which: 'minutesSaved',
						value: 15,
						basis: 'About a quarter of an hour for each phone call plus the schedule rewrite (consultant answer).',
						evidence: answerQuoteOf(
							answer,
							FOLLOWUP_QUOTE_CALL_DURATION,
						),
					},
				],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Canned assessment
// ---------------------------------------------------------------------------

const REJECTED_COOCCURRENCE_DETAIL =
	'the cited quote mentions both steps but contains no explicit trigger, handoff, or sequence phrase';

/** Base-variant assessment payload; exported for the smoke live-provider stub. */
export const CANNED_ASSESSMENT: AssessOutput = {
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

export function buildFollowupAssessment(): AssessOutput {
	return {
		...CANNED_ASSESSMENT,
		acceptedTransitionKeys: [
			...CANNED_ASSESSMENT.acceptedTransitionKeys,
			'edge_hotel_07',
		],
	};
}

// ---------------------------------------------------------------------------
// Canned proposals
// ---------------------------------------------------------------------------

/** Base-variant proposal payload; exported for the smoke live-provider stub. */
export const CANNED_PROPOSAL: ProposeOutput = {
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

/**
 * The housekeeping proposal cites the documented answer, so its evidence
 * carries the real persisted answer id; it is built per binding, not as a
 * constant.
 */
export function buildFollowupProposal(answer: {
	id: Id;
	sourceRev: number;
}): ProposeOutput {
	const cited = (quote: string): EvidenceCandidate =>
		answerQuoteOf(answer, quote);
	return {
		planKey: 'plan_hotel_02',
		steps: [
			{
				key: 'pstep_hotel_03',
				label: 'Post confirmed room changes to the shared housekeeping schedule automatically',
				currentStepIds: ['step_hotel_08'],
				evidence: [cited(FOLLOWUP_QUOTE_PHONE_AND_REWRITE)],
			},
			{
				key: 'pstep_hotel_04',
				label: 'Flag room changes that could not be posted for the next morning housekeeping briefing',
				currentStepIds: ['step_hotel_05'],
				evidence: [cited(FOLLOWUP_QUOTE_MISSED_CALLS)],
			},
		],
		edges: [
			{
				key: 'pedge_hotel_02',
				fromKey: 'pstep_hotel_03',
				toKey: 'pstep_hotel_04',
				label: 'Changes that fail to post are flagged for the morning briefing instead of being lost',
				evidence: [cited(FOLLOWUP_QUOTE_MISSED_CALLS)],
			},
		],
		planSections: {
			scope: 'Keep the housekeeping cleaning schedule current whenever a booking change is confirmed in YukiReserve, replacing the phone relay and the hand-rewritten rows; the morning arrivals list process stays unchanged.',
			businessRules:
				'Post a change to the shared schedule only after the booking change is saved in YukiReserve; a posted change marks the affected room as changed, never as cleaned; the housekeeping lead confirms reassignments before cleaners are redirected.',
			integrationsAuth:
				'A read-only watch on the reservations notifications inbox (or a YukiReserve change report) posting to the existing Excel schedule on the shared drive; the posting service account has write access to the schedule file only, and credentials stay server-side.',
			exceptions:
				'Changes that cannot be parsed or posted are flagged for the next morning housekeeping briefing; direct and phone bookings without a room change post nothing.',
			humanOversight:
				'Abe, the housekeeping lead, reviews posted changes at the start of each shift and before redirecting cleaners.',
			milestones:
				'1) Agree the shared schedule location with housekeeping. 2) Pilot posting confirmed room changes for one week. 3) Review missed-change flags with the desk and cut over.',
			acceptanceTests:
				'For ten sample room changes, the shared schedule shows the new room within five minutes of the booking change; unpostable changes appear in the next-morning flag list, and no change is ever marked cleaned automatically.',
		},
	};
}
