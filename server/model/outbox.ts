// Mail outbox access. Unique (report, audience, recipient) keys make
// double-enqueue a no-op (approved override for the generic jobs table).
import { getDb } from '../utils/db';

export type MailRow = {
	id: string;
	report_id: string;
	audience: 'owner' | 'staff';
	recipient: string;
	subject: string;
	body: string;
	provider: 'local' | 'resend';
	status: 'queued' | 'sent' | 'failed';
	attempts: number;
	last_error: string | null;
	next_attempt_at: number | null;
	created_at: string;
	sent_at: string | null;
};

export function findQueuedMailDue(nowMsValue: number): MailRow | undefined {
	return getDb()
		.prepare(
			`SELECT * FROM mail_outbox WHERE status = 'queued'
			 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
			 ORDER BY created_at LIMIT 1`,
		)
		.get(nowMsValue) as unknown as MailRow | undefined;
}
