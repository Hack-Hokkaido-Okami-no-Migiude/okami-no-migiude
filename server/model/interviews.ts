// Interview row access.
import type { InterviewCurrent, InterviewMode } from '#shared/types/domain';
import { getDb } from '../utils/db';

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

/** Wire shape for InterviewCurrent (includes mode — approved override). */
export function toInterviewCurrent(row: InterviewRow): InterviewCurrent {
	return {
		id: row.id,
		status: row.status,
		deadlineAt: row.deadline_at,
		mode: row.mode,
	};
}
