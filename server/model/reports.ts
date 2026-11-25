// Report row access. The report row is created synchronously at submit time;
// generation is asynchronous via the pending status + worker (§8 override).
import type { Locale, Report, ReportStatus } from '#shared/types/domain';
import { getDb } from '../utils/db';

export type ReportRow = {
	id: string;
	interview_id: string;
	owner_id: string;
	business_name: string;
	locale: Locale;
	status: ReportStatus;
	content: string | null;
	failure_reason: string | null;
	consultation_requested_at: string | null;
	created_at: string;
	ready_at: string | null;
	generate_attempts: number;
	generate_after: number | null;
};

export function findReportById(id: string): ReportRow | undefined {
	return getDb()
		.prepare('SELECT * FROM reports WHERE id = ?')
		.get(id) as unknown as ReportRow | undefined;
}

export function findReportByInterviewId(
	interviewId: string,
): ReportRow | undefined {
	return getDb()
		.prepare('SELECT * FROM reports WHERE interview_id = ?')
		.get(interviewId) as unknown as ReportRow | undefined;
}

export function findPendingReportDue(
	nowMsValue: number,
): ReportRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM reports WHERE status = 'pending'
			 AND (generate_after IS NULL OR generate_after <= ?)
			 ORDER BY created_at LIMIT 1`,
		)
		.get(nowMsValue) as unknown as ReportRow | undefined;
}

export function listStaffReportSummaries(): unknown[] {
	return getDb()
		.prepare(
			`SELECT r.*, u.email AS owner_email, p.name AS owner_name
			 FROM reports r
			 JOIN users u ON u.id = r.owner_id
			 JOIN owner_profiles p ON p.user_id = r.owner_id
			 ORDER BY r.created_at DESC`,
		)
		.all();
}

export type OwnerProfileRow = {
	user_id: string;
	municipality: string;
};

export function findOwnerProfileRow(
	userId: string,
): OwnerProfileRow | undefined {
	return getDb()
		.prepare(
			'SELECT user_id, municipality FROM owner_profiles WHERE user_id = ?',
		)
		.get(userId) as unknown as OwnerProfileRow | undefined;
}

export function insertReport(
	db: import('node:sqlite').DatabaseSync,
	input: {
		id: string;
		/** Null for voice-sourced reports; they carry voiceConversationId. */
		interviewId: string | null;
		voiceConversationId?: string | null;
		ownerId: string;
		businessName: string;
		locale: string;
		createdAt: string;
	},
): void {
	db.prepare(
		`INSERT INTO reports
			(id, interview_id, voice_conversation_id, owner_id, business_name, locale, status, content, failure_reason,
			 consultation_requested_at, created_at, ready_at, generate_attempts, generate_after)
		 VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, NULL, 0, NULL)`,
	).run(
		input.id,
		input.interviewId,
		input.voiceConversationId ?? null,
		input.ownerId,
		input.businessName,
		input.locale,
		input.createdAt,
	);
}

export function markReportReady(
	id: string,
	content: string,
	readyAt: string,
): boolean {
	const result = getDb()
		.prepare(
			"UPDATE reports SET status = 'ready', content = ?, ready_at = ? WHERE id = ? AND status = 'pending'",
		)
		.run(content, readyAt, id);
	return Number(result.changes) > 0;
}

export function markReportFailed(id: string, failureReason: string): void {
	getDb()
		.prepare(
			"UPDATE reports SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'pending'",
		)
		.run(failureReason, id);
}

export function markReportGenerateRetry(
	id: string,
	attempts: number,
	generateAfter: number,
): void {
	getDb()
		.prepare(
			'UPDATE reports SET generate_attempts = ?, generate_after = ? WHERE id = ?',
		)
		.run(attempts, generateAfter, id);
}

export function setConsultationRequestedAt(id: string, iso: string): boolean {
	const result = getDb()
		.prepare(
			'UPDATE reports SET consultation_requested_at = ? WHERE id = ? AND consultation_requested_at IS NULL',
		)
		.run(iso, id);
	return Number(result.changes) > 0;
}

/** Wire shape for Report (§4). */
export function toReport(row: ReportRow): Report {
	return {
		id: row.id,
		interviewId: row.interview_id,
		ownerId: row.owner_id,
		businessName: row.business_name,
		locale: row.locale,
		status: row.status,
		content: row.content,
		failureReason: row.failure_reason,
		consultationRequestedAt: row.consultation_requested_at,
		createdAt: row.created_at,
		readyAt: row.ready_at,
	};
}
