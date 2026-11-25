// Interview row access: the demo submit path plus the live-agent lifecycle
// (background research and the post-call Dify assessment). The live lifecycle
// mirrors voice_sessions: durable state on the row itself, so boot recovery
// is inherent and no separate jobs table is needed.
import type { InterviewCurrent, InterviewMode } from '#shared/types/domain';
import type { VoiceResearchCase } from '#shared/types/voice';
import type { VoiceBusiness } from '../voice/providers';
import { parseVoiceCases } from '../voice/model';
import { getDb, inTransaction } from '../utils/db';

export type InterviewResearchStatus =
	'idle' | 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';

export type InterviewAssessmentStatus =
	'idle' | 'queued' | 'running' | 'completed' | 'failed';

export type InterviewAssessmentResearchStatus =
	'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

export type InterviewRow = {
	id: string;
	owner_id: string;
	mode: InterviewMode;
	status: 'active' | 'submitted';
	consent_at: string;
	started_at: string;
	deadline_at: string;
	submitted_at: string | null;
	transcript: string | null;
	conversation_id: string | null;
	business_json: string | null;
	report_language: string | null;
	research_status: InterviewResearchStatus;
	research_task_id: string | null;
	research_deadline: number | null;
	research_poll_at: number | null;
	research_cases: string | null;
	assessment_status: InterviewAssessmentStatus;
	assessment_attempts: number;
	assessment_after: number | null;
	assessment_deadline: number | null;
	assessment_report_id: string | null;
	assessment_research_status: InterviewAssessmentResearchStatus;
	assessment_research_task_id: string | null;
	assessment_research_deadline: number | null;
	assessment_research_poll_at: number | null;
	assessment_research_cases: string | null;
	created_at: string;
};

export function findInterviewById(id: string): InterviewRow | undefined {
	return getDb()
		.prepare('SELECT * FROM interviews WHERE id = ?')
		.get(id) as unknown as InterviewRow | undefined;
}

/** "Current" prefers the owner's submitted interview (one per owner). */
export function findCurrentSubmittedInterview(
	ownerId: string,
): InterviewRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM interviews WHERE owner_id = ? AND status = 'submitted'
			 ORDER BY started_at DESC LIMIT 1`,
		)
		.get(ownerId) as unknown as InterviewRow | undefined;
}

/** Active and not yet expired; expiry is derived from deadline_at. */
export function findActiveUnexpiredInterview(
	ownerId: string,
	nowIsoText: string,
): InterviewRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM interviews WHERE owner_id = ? AND status = 'active' AND deadline_at > ?
			 ORDER BY started_at DESC LIMIT 1`,
		)
		.get(ownerId, nowIsoText) as unknown as InterviewRow | undefined;
}

// ---------------------------------------------------------------------------
// Minted conversation association: POST /api/voice/sessions records the
// ElevenLabs conversation it minted for the interview, so the post-call
// webhook can still reach the interview when the client could not pass the
// interview id as a dynamic variable.
// ---------------------------------------------------------------------------

/** The owner's active, unexpired live interview (the mint precondition). */
export function findActiveLiveInterview(
	ownerId: string,
	nowIsoText: string,
): InterviewRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM interviews WHERE owner_id = ? AND mode = 'live' AND status = 'active' AND deadline_at > ?
			ORDER BY started_at DESC LIMIT 1`,
		)
		.get(ownerId, nowIsoText) as unknown as InterviewRow | undefined;
}

/**
 * Records which conversation was minted for the interview. Latest wins: a
 * re-mint (client retry) repoints the interview at the conversation that
 * will actually run.
 */
export function recordInterviewConversation(
	interviewId: string,
	conversationId: string,
): void {
	getDb()
		.prepare('UPDATE interviews SET conversation_id = ? WHERE id = ?')
		.run(conversationId, interviewId);
}

/** The interview a minted conversation belongs to (webhook fallback lookup). */
export function findInterviewByConversation(
	conversationId: string,
): InterviewRow | undefined {
	return getDb()
		.prepare('SELECT * FROM interviews WHERE conversation_id = ?')
		.get(conversationId) as unknown as InterviewRow | undefined;
}

export function insertInterview(
	db: import('node:sqlite').DatabaseSync,
	input: {
		id: string;
		ownerId: string;
		mode: InterviewMode;
		startedAt: string;
		deadlineAt: string;
	},
): void {
	db.prepare(
		`INSERT INTO interviews
			(id, owner_id, mode, status, consent_at, started_at, deadline_at, submitted_at, transcript, created_at)
		 VALUES (?, ?, ?, 'active', ?, ?, ?, NULL, NULL, ?)`,
	).run(
		input.id,
		input.ownerId,
		input.mode,
		input.startedAt,
		input.startedAt,
		input.deadlineAt,
		input.startedAt,
	);
}

/**
 * Live start: snapshots the profile-derived business intake and the report
 * language onto the row, so the research pass and the Dify assessment run
 * from the same intake the agent saw even if the profile changes later.
 */
export function insertLiveInterview(
	db: import('node:sqlite').DatabaseSync,
	input: {
		id: string;
		ownerId: string;
		startedAt: string;
		deadlineAt: string;
		business: VoiceBusiness;
		reportLanguage: string;
	},
): void {
	db.prepare(
		`INSERT INTO interviews
			(id, owner_id, mode, status, consent_at, started_at, deadline_at, submitted_at,
			transcript, business_json, report_language, created_at)
		 VALUES (?, ?, 'live', 'active', ?, ?, ?, NULL, NULL, ?, ?, ?)`,
	).run(
		input.id,
		input.ownerId,
		input.startedAt,
		input.startedAt,
		input.deadlineAt,
		JSON.stringify(input.business),
		input.reportLanguage,
		input.startedAt,
	);
}

/** Wire shape for InterviewCurrent (includes mode — approved override). */
export function toInterviewCurrent(row: InterviewRow): InterviewCurrent {
	const current: InterviewCurrent = {
		id: row.id,
		status: row.status,
		deadlineAt: row.deadline_at,
		mode: row.mode,
	};
	if (row.mode === 'live') {
		current.research = {
			status: row.research_status,
			started: row.research_task_id !== null,
			cases: parseInterviewCases(row.research_cases),
		};
		current.assessment = {
			status: row.assessment_status,
			reportId: row.assessment_report_id,
		};
	}
	return current;
}

/** The stored research cases JSON, safely re-parsed (shape-checked upstream). */
function parseInterviewCases(raw: string | null): VoiceResearchCase[] {
	return parseVoiceCases(raw) as VoiceResearchCase[];
}

// ---------------------------------------------------------------------------
// Live research lifecycle: one Linkup pass over the owner's profile intake,
// queued when the live interview starts and re-queueable by the agent's
// start-research webhook tool. Same durable pattern as voice_sessions.
// ---------------------------------------------------------------------------

export type InterviewQueueResult =
	'missing' | 'queued' | InterviewResearchStatus;

/** Idempotent (re)queue from the agent's start_research webhook tool. */
export function queueInterviewResearch(
	interviewId: string,
	business: VoiceBusiness,
	deadline: number,
): InterviewQueueResult {
	const row = findInterviewById(interviewId);
	if (!row || row.mode !== 'live') {
		return 'missing';
	}
	if (row.research_status !== 'idle') {
		return row.research_status;
	}
	if (row.transcript !== null) {
		return 'failed';
	}
	getDb()
		.prepare(
			`UPDATE interviews SET research_status = 'queued', research_deadline = ?
			 WHERE id = ? AND mode = 'live' AND research_status = 'idle' AND transcript IS NULL`,
		)
		.run(deadline, interviewId);
	return 'queued';
}

/**
 * Abandoned interviews: starting a new live interview stops the pending
 * research of the owner's other transcript-less live interviews by expiring
 * their deadline.
 */
export function supersedePendingInterviewResearch(
	db: import('node:sqlite').DatabaseSync,
	ownerId: string,
	exceptInterviewId: string,
): void {
	db.prepare(
		`UPDATE interviews SET research_deadline = 0
		 WHERE owner_id = ? AND id != ? AND mode = 'live' AND status = 'active'
		   AND transcript IS NULL
		   AND research_status IN ('queued', 'submitting', 'polling')`,
	).run(ownerId, exceptInterviewId);
}

/** Live interviews whose research is due: queued, or polling past its poll. */
export function findDueInterviewResearch(
	now: number,
): InterviewRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM interviews
			 WHERE mode = 'live'
			   AND (research_status = 'queued'
			      OR (research_status = 'polling'
			          AND (research_poll_at <= ? OR research_deadline <= ?)))
			 ORDER BY created_at
			 LIMIT 1`,
		)
		.get(now, now) as unknown as InterviewRow | undefined;
}

export function claimInterviewResearch(interviewId: string): void {
	getDb()
		.prepare(
			"UPDATE interviews SET research_status = 'submitting' WHERE id = ?",
		)
		.run(interviewId);
}

export function saveInterviewResearchTask(
	interviewId: string,
	taskId: string,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			`UPDATE interviews
			 SET research_status = 'polling', research_task_id = ?, research_poll_at = ?
			 WHERE id = ?`,
		)
		.run(taskId, nextPoll, interviewId);
}

export function deferInterviewResearchPoll(
	interviewId: string,
	nextPoll: number,
): void {
	getDb()
		.prepare('UPDATE interviews SET research_poll_at = ? WHERE id = ?')
		.run(nextPoll, interviewId);
}

export function finishInterviewResearch(
	interviewId: string,
	cases: string | null,
): void {
	getDb()
		.prepare(
			'UPDATE interviews SET research_status = ?, research_cases = ? WHERE id = ?',
		)
		.run(cases === null ? 'failed' : 'completed', cases, interviewId);
}

// ---------------------------------------------------------------------------
// Post-call transcript storage: the webhook is the only writer for live
// interviews. First transcript wins (idempotent replay), and a live
// interview whose owner already has a submitted interview is superseded
// instead of violating the one-submitted-interview invariant.
// ---------------------------------------------------------------------------

export type LiveTranscriptResult =
	'stored' | 'already_submitted' | 'superseded';

/**
 * Stores the agent transcript on the live interview and marks it submitted.
 * Returns what happened so the webhook can answer honestly without leaking
 * details: a replay keeps the first transcript, and an interview superseded
 * by the owner's newer submitted interview is left untouched.
 */
export function saveLiveInterviewTranscript(
	interviewId: string,
	transcript: string,
	submittedAtIso: string,
): LiveTranscriptResult {
	return inTransaction((db) => {
		const row = db
			.prepare('SELECT * FROM interviews WHERE id = ?')
			.get(interviewId) as unknown as InterviewRow | undefined;
		if (!row || row.mode !== 'live') {
			return 'superseded';
		}
		if (row.status === 'submitted') {
			return 'already_submitted';
		}
		const competing = db
			.prepare(
				"SELECT id FROM interviews WHERE owner_id = ? AND status = 'submitted' AND id != ? LIMIT 1",
			)
			.get(row.owner_id, interviewId);
		if (competing) {
			return 'superseded';
		}
		const changed = db
			.prepare(
				"UPDATE interviews SET status = 'submitted', submitted_at = ?, transcript = ? WHERE id = ? AND status = 'active'",
			)
			.run(submittedAtIso, transcript, interviewId);
		return Number(changed.changes) > 0 ? 'stored' : 'superseded';
	});
}

// ---------------------------------------------------------------------------
// Live assessment lifecycle: the stored transcript queues the Dify
// assessment; the worker runs the transcript-informed deep research pass and
// then the Dify report. Mirrors the voice_sessions assessment lifecycle.
// ---------------------------------------------------------------------------

export type InterviewAssessmentQueueResult =
	'missing' | 'no_transcript' | InterviewAssessmentStatus;

/** Idempotent: only a stored transcript with an idle assessment can queue. */
export function enqueueInterviewAssessment(
	interviewId: string,
): InterviewAssessmentQueueResult {
	const row = findInterviewById(interviewId);
	if (!row || row.mode !== 'live') {
		return 'missing';
	}
	if (row.transcript === null) {
		return 'no_transcript';
	}
	if (row.assessment_status !== 'idle') {
		return row.assessment_status;
	}
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_status = 'queued' WHERE id = ? AND mode = 'live' AND assessment_status = 'idle'",
		)
		.run(interviewId);
	return 'queued';
}

/**
 * Due for assessment work: a submitted live interview whose research reached
 * a terminal state, with the same queued/running/crashed-reap conditions as
 * the voice assessment (see findDueVoiceAssessment).
 */
export function findDueInterviewAssessment(
	now: number,
): InterviewRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM interviews
			 WHERE mode = 'live'
			   AND status = 'submitted'
			   AND transcript IS NOT NULL
			   AND research_status IN ('completed', 'failed')
			   AND (
			     (assessment_status = 'queued'
			      AND (assessment_after IS NULL OR assessment_after <= ?))
			     OR (assessment_status = 'running' AND (
			       assessment_deadline <= ?
			       OR assessment_research_status IN ('idle', 'completed', 'failed')
			       OR (assessment_research_status = 'polling'
			           AND assessment_research_poll_at <= ?)
			     ))
			   )
			 ORDER BY created_at
			 LIMIT 1`,
		)
		.get(now, now, now) as unknown as InterviewRow | undefined;
}

export function claimInterviewAssessment(
	interviewId: string,
	deadline: number,
): void {
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_status = 'running', assessment_deadline = ? WHERE id = ?",
		)
		.run(deadline, interviewId);
}

export function retryInterviewAssessment(
	interviewId: string,
	attempts: number,
	after: number,
): void {
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_status = 'queued', assessment_attempts = ?, assessment_after = ?, assessment_deadline = NULL WHERE id = ?",
		)
		.run(attempts, after, interviewId);
}

export function failInterviewAssessment(
	interviewId: string,
	attempts: number,
): void {
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_status = 'failed', assessment_attempts = ?, assessment_deadline = NULL WHERE id = ?",
		)
		.run(attempts, interviewId);
}

export function finishInterviewAssessment(
	interviewId: string,
	reportId: string,
): void {
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_status = 'completed', assessment_deadline = NULL, assessment_report_id = ? WHERE id = ?",
		)
		.run(reportId, interviewId);
}

export function claimInterviewAssessmentResearch(interviewId: string): void {
	getDb()
		.prepare(
			"UPDATE interviews SET assessment_research_status = 'submitting' WHERE id = ?",
		)
		.run(interviewId);
}

export function saveInterviewAssessmentTask(
	interviewId: string,
	taskId: string,
	deadline: number,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			`UPDATE interviews
			 SET assessment_research_status = 'polling', assessment_research_task_id = ?,
			     assessment_research_deadline = ?, assessment_research_poll_at = ?
			 WHERE id = ?`,
		)
		.run(taskId, deadline, nextPoll, interviewId);
}

export function deferInterviewAssessmentPoll(
	interviewId: string,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			'UPDATE interviews SET assessment_research_poll_at = ? WHERE id = ?',
		)
		.run(nextPoll, interviewId);
}

export function finishInterviewAssessmentResearch(
	interviewId: string,
	dossier: string | null,
): void {
	getDb()
		.prepare(
			'UPDATE interviews SET assessment_research_status = ?, assessment_research_cases = ? WHERE id = ?',
		)
		.run(dossier === null ? 'failed' : 'completed', dossier, interviewId);
}

/** The business name snapshot for the live report (owner profile). */
export function findOwnerBusinessName(ownerId: string): string {
	const row = getDb()
		.prepare('SELECT business_name FROM owner_profiles WHERE user_id = ?')
		.get(ownerId) as unknown as { business_name: string } | undefined;
	return row?.business_name ?? '';
}
