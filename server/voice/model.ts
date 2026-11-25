// Voice session row access. One row per ElevenLabs conversation; the
// research lifecycle lives on the row itself (durable pending state, same
// pattern as the reports/mail worker), so boot recovery is inherent.
import type { Locale } from '#shared/types/domain';
import { getDb } from '../utils/db';
import type { VoiceBusiness } from './providers';

export type VoiceResearchStatus =
	'idle' | 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';

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
		businessType: read('businessType'),
	};
	return business.businessName || business.location || business.businessType ?
			business
		:	null;
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
