// Local delivery provider (§9, default): writes an RFC 5322-ish .eml file with
// one stable filename per message (<mailId>.eml), then the outbox row is
// marked sent. No network access.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LocalMail = {
	id: string;
	to: string;
	from: string;
	subject: string;
	body: string;
	sentAt: string;
};

export function buildEml(mail: LocalMail): string {
	const headers = [
		`To: ${mail.to}`,
		`From: ${mail.from}`,
		`Subject: ${mail.subject}`,
		`Date: ${mail.sentAt}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=utf-8',
		'Content-Transfer-Encoding: 8bit',
		'X-Okami-Demo: local-outbox',
	];
	return `${headers.join('\n')}\n\n${mail.body}`;
}

export function deliverLocal(mail: LocalMail, mailOutboxDir: string): void {
	mkdirSync(mailOutboxDir, { recursive: true });
	writeFileSync(
		join(mailOutboxDir, `${mail.id}.eml`),
		buildEml(mail),
		'utf8',
	);
}
