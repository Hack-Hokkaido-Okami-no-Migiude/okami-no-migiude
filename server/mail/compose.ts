// Mail composition (§9): fully rendered at enqueue time, subject and body in
// the recipient-relevant locale, body carries the absolute protected report
// link. Providers stay dumb senders.
import type { Locale } from '#shared/types/domain';

export type MailAudience = 'owner' | 'staff';

export type MailDraft = {
	audience: MailAudience;
	recipient: string;
	subject: string;
	body: string;
};

export type ComposeInput = {
	audience: MailAudience;
	recipient: string;
	recipientName: string;
	ownerName: string;
	ownerEmail: string;
	businessName: string;
	locale: Locale;
	reportId: string;
	reportUrl: string;
};

export function composeReportReadyMail(input: ComposeInput): MailDraft {
	return input.locale === 'ja' ? composeJa(input) : composeEn(input);
}

function composeJa(input: ComposeInput): MailDraft {
	if (input.audience === 'owner') {
		return {
			audience: 'owner',
			recipient: input.recipient,
			subject: `【女将の右腕】レポートが完成しました（${input.businessName}）`,
			body: [
				`${input.recipientName} 様`,
				'',
				`「${input.businessName}」の面談レポートが完成しました。`,
				'下のリンクからご確認ください。',
				'',
				input.reportUrl,
				'',
				'※ レポートは「自動下書き（ルールベース）」です。',
				'※ このメールはデモ環境のローカル配信です。',
				'',
				'女将の右腕（デモ環境）',
				'',
			].join('\n'),
		};
	}
	return {
		audience: 'staff',
		recipient: input.recipient,
		subject: `【女将の右腕】レポート完成: ${input.businessName}（${input.ownerName} 様）`,
		body: [
			'担当スタッフ各位',
			'',
			`経営者: ${input.ownerName} 様（${input.ownerEmail}）`,
			`事業所: ${input.businessName}`,
			'面談レポートが完成しました。',
			'',
			input.reportUrl,
			'',
			'※ 相談申込の状況はスタッフ用レポート一覧で確認できます。',
			'※ このメールはデモ環境のローカル配信です。',
			'',
			'女将の右腕（デモ環境）',
			'',
		].join('\n'),
	};
}

function composeEn(input: ComposeInput): MailDraft {
	if (input.audience === 'owner') {
		return {
			audience: 'owner',
			recipient: input.recipient,
			subject: `[Okami no Migiude] Your report is ready (${input.businessName})`,
			body: [
				`Hello ${input.recipientName},`,
				'',
				`The interview report for "${input.businessName}" is ready.`,
				'Open it here:',
				'',
				input.reportUrl,
				'',
				'Note: the report is an "Automated draft (rule-based)".',
				'This message was delivered by the local demo outbox.',
				'',
				'Okami no Migiude (demo)',
				'',
			].join('\n'),
		};
	}
	return {
		audience: 'staff',
		recipient: input.recipient,
		subject: `[Okami no Migiude] Report ready: ${input.businessName} (${input.ownerName})`,
		body: [
			'Dear support staff,',
			'',
			`Business owner: ${input.ownerName} (${input.ownerEmail})`,
			`Business: ${input.businessName}`,
			'The interview report is ready.',
			'',
			input.reportUrl,
			'',
			'Consultation status is visible in the staff report list.',
			'This message was delivered by the local demo outbox.',
			'',
			'Okami no Migiude (demo)',
			'',
		].join('\n'),
	};
}
