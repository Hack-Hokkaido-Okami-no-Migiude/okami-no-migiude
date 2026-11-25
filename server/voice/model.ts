// Voice session row access. One row per ElevenLabs conversation; the
// research lifecycle lives on the row itself (durable pending state, same
// pattern as the reports/mail worker), so boot recovery is inherent.
import type { Locale } from '#shared/types/domain';
import { getDb } from '../utils/db';
import type { VoiceBusiness } from './providers';

export type VoiceResearchStatus =
	'idle' | 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';

export type VoiceAssessmentStatus =
	'idle' | 'queued' | 'running' | 'completed' | 'failed';

export type VoiceAssessmentResearchStatus =
	'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

export type VoiceSessionRow = {
	conversation_id: string;
	owner_id: string;
	consent_at: string;
	report_language: Locale;
	business: string | null;
	research_status: VoiceResearchStatus;
	research_task_id: string | null;
	research_deadline: number | null;
	research_poll_at: number | null;
	research_cases: string | null;
	transcript: string | null;
	assessment_status: VoiceAssessmentStatus;
	assessment_attempts: number;
	assessment_after: number | null;
	assessment_deadline: number | null;
	assessment_report_id: string | null;
	assessment_research_status: VoiceAssessmentResearchStatus;
	assessment_research_task_id: string | null;
	assessment_research_deadline: number | null;
	assessment_research_poll_at: number | null;
	assessment_research_cases: string | null;
	created_at: string;
};

export function findVoiceSessionByConversation(
	conversationId: string,
): VoiceSessionRow | undefined {
	return getDb()
		.prepare('SELECT * FROM voice_sessions WHERE conversation_id = ?')
		.get(conversationId) as unknown as VoiceSessionRow | undefined;
}

export function findLatestVoiceSessionByOwner(
	ownerId: string,
): VoiceSessionRow | undefined {
	return getDb()
		.prepare(
			'SELECT * FROM voice_sessions WHERE owner_id = ? ORDER BY created_at DESC, conversation_id DESC LIMIT 1',
		)
		.get(ownerId) as unknown as VoiceSessionRow | undefined;
}

export function insertVoiceSession(
	db: import('node:sqlite').DatabaseSync,
	input: {
		conversationId: string;
		ownerId: string;
		consentAt: string;
		reportLanguage: Locale;
		business: VoiceBusiness;
		researchDeadline: number;
		createdAt: string;
	},
): void {
	db.prepare(
		`INSERT INTO voice_sessions
			(conversation_id, owner_id, consent_at, report_language, business,
			 research_status, research_task_id, research_deadline, research_poll_at,
			 research_cases, transcript, created_at)
		 VALUES (?, ?, ?, ?, ?, 'queued', NULL, ?, NULL, NULL, NULL, ?)`,
	).run(
		input.conversationId,
		input.ownerId,
		input.consentAt,
		input.reportLanguage,
		JSON.stringify(input.business),
		input.researchDeadline,
		input.createdAt,
	);
}

/**
 * Abandoned sessions: starting a new chat stops the pending research of the
 * owner's other transcript-less sessions by expiring their deadline.
 */
export function supersedePendingVoiceSessions(
	db: import('node:sqlite').DatabaseSync,
	ownerId: string,
	exceptConversationId: string,
): void {
	db.prepare(
		`UPDATE voice_sessions SET research_deadline = 0
		 WHERE owner_id = ? AND conversation_id != ? AND transcript IS NULL
		   AND research_status IN ('queued', 'submitting', 'polling')`,
	).run(ownerId, exceptConversationId);
}

export type VoiceQueueResult = 'missing' | 'queued' | VoiceResearchStatus;

/** Idempotent (re)queue from the agent's start_research webhook tool. */
export function queueVoiceResearch(
	conversationId: string,
	business: VoiceBusiness,
	deadline: number,
): VoiceQueueResult {
	const row = findVoiceSessionByConversation(conversationId);
	if (!row) {
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
			`UPDATE voice_sessions SET business = ?, research_deadline = ?, research_status = 'queued'
			 WHERE conversation_id = ? AND research_status = 'idle' AND transcript IS NULL`,
		)
		.run(JSON.stringify(business), deadline, conversationId);
	return 'queued';
}

export function claimVoiceResearch(conversationId: string): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET research_status = 'submitting' WHERE conversation_id = ?",
		)
		.run(conversationId);
}

export function saveVoiceTask(
	conversationId: string,
	taskId: string,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			`UPDATE voice_sessions
			 SET research_status = 'polling', research_task_id = ?, research_poll_at = ?
			 WHERE conversation_id = ?`,
		)
		.run(taskId, nextPoll, conversationId);
}

export function deferVoicePoll(conversationId: string, nextPoll: number): void {
	getDb()
		.prepare(
			'UPDATE voice_sessions SET research_poll_at = ? WHERE conversation_id = ?',
		)
		.run(nextPoll, conversationId);
}

export function finishVoiceResearch(
	conversationId: string,
	cases: string | null,
): void {
	getDb()
		.prepare(
			'UPDATE voice_sessions SET research_status = ?, research_cases = ? WHERE conversation_id = ?',
		)
		.run(cases === null ? 'failed' : 'completed', cases, conversationId);
}

/** Idempotent: only the first transcript wins (like the okami_voice demo). */
export function saveVoiceTranscript(
	conversationId: string,
	transcript: string,
): void {
	getDb()
		.prepare(
			'UPDATE voice_sessions SET transcript = ? WHERE conversation_id = ? AND transcript IS NULL',
		)
		.run(transcript, conversationId);
}

// Assessment lifecycle: the post-call webhook queues once the transcript is
// stored; the worker runs the Dify report and mails it. Same durable-state
// pattern as the research lifecycle above.

export type VoiceAssessmentQueueResult =
	'missing' | 'no_transcript' | VoiceAssessmentStatus;

/** Idempotent: only a stored transcript with an idle assessment can queue. */
export function enqueueVoiceAssessment(
	conversationId: string,
): VoiceAssessmentQueueResult {
	const row = findVoiceSessionByConversation(conversationId);
	if (!row) {
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
			"UPDATE voice_sessions SET assessment_status = 'queued' WHERE conversation_id = ? AND assessment_status = 'idle'",
		)
		.run(conversationId);
	return 'queued';
}

/**
 * Due for assessment work: queued (respecting retry backoff) whose research
 * has reached a terminal state, or running while real work is pending —
 * the deep pass awaiting its next poll, research already terminal (resume
 * at the Dify write), or past the deadline (a crashed in-flight run that
 * the caller fails instead of trusting).
 */
export function findDueVoiceAssessment(
	now: number,
): VoiceSessionRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM voice_sessions
			 WHERE transcript IS NOT NULL
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
		.get(now, now, now) as unknown as VoiceSessionRow | undefined;
}

export function claimVoiceAssessment(
	conversationId: string,
	deadline: number,
): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET assessment_status = 'running', assessment_deadline = ? WHERE conversation_id = ?",
		)
		.run(deadline, conversationId);
}

export function retryVoiceAssessment(
	conversationId: string,
	attempts: number,
	after: number,
): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET assessment_status = 'queued', assessment_attempts = ?, assessment_after = ?, assessment_deadline = NULL WHERE conversation_id = ?",
		)
		.run(attempts, after, conversationId);
}

export function failVoiceAssessment(
	conversationId: string,
	attempts: number,
): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET assessment_status = 'failed', assessment_attempts = ?, assessment_deadline = NULL WHERE conversation_id = ?",
		)
		.run(attempts, conversationId);
}

export function finishVoiceAssessment(
	conversationId: string,
	reportId: string,
): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET assessment_status = 'completed', assessment_deadline = NULL, assessment_report_id = ? WHERE conversation_id = ?",
		)
		.run(reportId, conversationId);
}

// Deep-pass lifecycle: a second Linkup research run (heaviest reasoning
// depth, transcript-informed query) owned by the assessment job. The result
// is the deep dossier — a sourced report, not a case list — stored as JSON
// in assessment_research_cases. Mirrors the in-call research functions.

export function claimAssessmentResearch(conversationId: string): void {
	getDb()
		.prepare(
			"UPDATE voice_sessions SET assessment_research_status = 'submitting' WHERE conversation_id = ?",
		)
		.run(conversationId);
}

export function saveAssessmentTask(
	conversationId: string,
	taskId: string,
	deadline: number,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			`UPDATE voice_sessions
			 SET assessment_research_status = 'polling', assessment_research_task_id = ?,
			     assessment_research_deadline = ?, assessment_research_poll_at = ?
			 WHERE conversation_id = ?`,
		)
		.run(taskId, deadline, nextPoll, conversationId);
}

export function deferAssessmentPoll(
	conversationId: string,
	nextPoll: number,
): void {
	getDb()
		.prepare(
			'UPDATE voice_sessions SET assessment_research_poll_at = ? WHERE conversation_id = ?',
		)
		.run(nextPoll, conversationId);
}

export function finishAssessmentResearch(
	conversationId: string,
	cases: string | null,
): void {
	getDb()
		.prepare(
			'UPDATE voice_sessions SET assessment_research_status = ?, assessment_research_cases = ? WHERE conversation_id = ?',
		)
		.run(cases === null ? 'failed' : 'completed', cases, conversationId);
}

/** Sessions whose research is due: queued, or polling past its poll time. */
export function findDueVoiceSession(now: number): VoiceSessionRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM voice_sessions
			 WHERE research_status = 'queued'
			    OR (research_status = 'polling'
			        AND (research_poll_at <= ? OR research_deadline <= ?))
			 ORDER BY created_at
			 LIMIT 1`,
		)
		.get(now, now) as unknown as VoiceSessionRow | undefined;
}

function jsonObject(raw: string | null): Record<string, unknown> | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ?
				(parsed as Record<string, unknown>)
			:	null;
	} catch {
		return null;
	}
}

/** The stored business intake JSON, safely re-parsed. */
export function parseVoiceBusiness(raw: string | null): VoiceBusiness | null {
	const parsed = jsonObject(raw);
	if (!parsed) {
		return null;
	}
	const read = (key: string) =>
		typeof parsed[key] === 'string' ? (parsed[key] as string) : '';
	const business: VoiceBusiness = {
		businessName: read('businessName'),
		location: read('location'),
	};
	return business.businessName || business.location ? business : null;
}

/** The stored research cases JSON, safely re-parsed. */
export function parseVoiceCases(raw: string | null): unknown[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
