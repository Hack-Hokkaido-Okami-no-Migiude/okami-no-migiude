// Mail queue processing: compose-at-enqueue rows live in mail_outbox with
// unique (report, audience, recipient) keys; this module delivers one due mail
// per call and applies §8-style retry semantics (2^attempts x 30s, max 5).
// Provider is selected per attempt from env:
// - 'resend': the only live sender (see ./resend.ts); enabled when
//   MAIL_RESEND_API_KEY is set. Idempotent REST delivery; the synchronous
//   worker loop starts at most one live attempt at a time and the row settles
//   inside the awaited continuation.
// - 'local' (default without a key): .eml files, no network (§9 substitute).
import { dataDir, mailFrom, publicBaseUrl } from '../utils/env';
import { deliverLiveMail, liveMailConfigured } from './resend';
import { nowIso, nowMs } from '../utils/clock';
import type { DatabaseSync } from 'node:sqlite';
import type { MailRow } from '../model/outbox';
import { composeReportReadyMail } from './compose';
import { deliverLocal } from './local';
import { findQueuedMailDue } from '../model/outbox';
import { getDb } from '../utils/db';
import { join } from 'node:path';
import { newId } from '../utils/ids';
import { sanitizeError } from '../utils/errors';

const MAX_ATTEMPTS = 5;

type DeliverableProvider = 'local' | 'resend';

/**
 * The worker loop is synchronous; a live REST attempt is not. While one live
 * send is in flight this holds its mail id, so the next tick skips delivery
 * (returns false) instead of starting a concurrent duplicate attempt. The row
 * is only settled inside the awaited continuation; a crash mid-flight simply
 * leaves it queued for the next boot.
 */
let liveDeliveryInFlight: string | null = null;

/** Provider per attempt from env (§9): resend when configured, else local. */
function selectMailProvider(): DeliverableProvider {
	if (liveMailConfigured()) {
		return 'resend';
	}
	return 'local';
}

function markMailSent(provider: 'local' | 'resend', mailId: string): void {
	getDb()
		.prepare(
			"UPDATE mail_outbox SET status = 'sent', sent_at = ?, provider = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued'",
		)
		.run(nowIso(), provider, mailId);
}

function applyMailFailure(mail: MailRow, error: unknown): void {
	const attempts = mail.attempts + 1;
	const lastError = sanitizeError(error);
	if (attempts >= MAX_ATTEMPTS) {
		getDb()
			.prepare(
				"UPDATE mail_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
			)
			.run(attempts, lastError, mail.id);
	} else {
		getDb()
			.prepare(
				'UPDATE mail_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
			)
			.run(attempts, nowMs() + backoffMs(attempts), lastError, mail.id);
	}
}

/** Processes at most one due mail; returns whether work was done or started. */
export function processQueuedMail(): boolean {
	const dueAt = nowMs();
	const mail = findQueuedMailDue(dueAt);
	if (!mail) {
		return false;
	}
	const provider = selectMailProvider();
	if (provider === 'resend') {
		if (liveDeliveryInFlight !== null) {
			return false;
		}
		liveDeliveryInFlight = mail.id;
		void deliverLiveAndSettle(mail);
		return true;
	}
	try {
		deliverLocal(
			{
				id: mail.id,
				to: mail.recipient,
				from: mailFrom(),
				subject: mail.subject,
				body: mail.body,
				sentAt: nowIso(),
			},
			join(dataDir(), 'mail-outbox'),
		);
		markMailSent('local', mail.id);
	} catch (error) {
		applyMailFailure(mail, error);
	}
	return true;
}

async function deliverLiveAndSettle(mail: MailRow): Promise<void> {
	try {
		await deliverLiveMail({
			id: mail.id,
			to: mail.recipient,
			from: mailFrom(),
			subject: mail.subject,
			body: mail.body,
		});
		// 'resend' is the live slot of the §9 provider enum (schema owned
		// outside server/mail/); the live REST provider records that slot.
		markMailSent('resend', mail.id);
	} catch (error) {
		applyMailFailure(mail, error);
	} finally {
		liveDeliveryInFlight = null;
	}
}

export function backoffMs(attempts: number): number {
	return 2 ** attempts * 30_000;
}

/** Composes and inserts the report-ready mails inside the caller's
 * transaction (same transaction that marks the report ready — § override). */
export function enqueueReportReadyMails(
	db: DatabaseSync,
	report: {
		id: string;
		business_name: string;
		locale: string;
		owner_id: string;
	},
): void {
	const reportUrl = `${publicBaseUrl()}/reports/${report.id}`;
	const owner = db
		.prepare(
			`SELECT u.email AS email, p.name AS name
			 FROM users u JOIN owner_profiles p ON p.user_id = u.id WHERE u.id = ?`,
		)
		.get(report.owner_id) as unknown as
		{ email: string; name: string } | undefined;
	if (!owner) {
		return;
	}
	const locale = (report.locale === 'en' ? 'en' : 'ja') as 'ja' | 'en';
	const recipients: {
		audience: 'owner' | 'staff';
		email: string;
		name: string;
	}[] = [{ audience: 'owner', email: owner.email, name: owner.name }];
	for (const email of listStaffEmailsFrom(db)) {
		recipients.push({
			audience: 'staff',
			email,
			name: email.split('@')[0] || email,
		});
	}
	for (const recipient of recipients) {
		const draft = composeReportReadyMail({
			audience: recipient.audience,
			recipient: recipient.email,
			recipientName: recipient.name,
			ownerName: owner.name,
			ownerEmail: owner.email,
			businessName: report.business_name,
			locale,
			reportId: report.id,
			reportUrl,
		});
		db.prepare(
			`INSERT OR IGNORE INTO mail_outbox
				(id, report_id, audience, recipient, subject, body, provider, status, attempts, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'local', 'queued', 0, ?)`,
		).run(
			newId(),
			report.id,
			draft.audience,
			draft.recipient,
			draft.subject,
			draft.body,
			nowIso(),
		);
	}
}

function listStaffEmailsFrom(db: DatabaseSync): string[] {
	return (
		db
			.prepare(
				"SELECT email FROM users WHERE role = 'staff' ORDER BY email",
			)
			.all() as unknown as { email: string }[]
	).map((row) => row.email);
}
