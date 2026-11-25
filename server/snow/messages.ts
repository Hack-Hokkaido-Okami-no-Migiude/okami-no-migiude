// Snow-day message drafts, one per guest in the guest's own language.
// Deliberately plain and factual: no promises about fees, refunds or
// transport. The okami reads, edits and approves every draft before it goes
// out (human in the loop), and the owner-side gloss lets her check what a
// draft in a language she does not read actually says.
import type { SnowKind } from './jma';

export type GuestLanguage = 'ja' | 'en' | 'zh-TW' | 'ko';
export const GUEST_LANGUAGES: readonly GuestLanguage[] = [
	'ja',
	'en',
	'zh-TW',
	'ko',
];

export type DraftVars = {
	guestName: string;
	innName: string;
	innPhone: string | null;
	arrivalDate: string; // YYYY-MM-DD (inn local date)
	warningCode: string;
};

const WARNING_NAMES: Record<string, Record<GuestLanguage, string>> = {
	'12': {
		ja: '大雪注意報',
		en: 'a heavy snow advisory',
		'zh-TW': '大雪注意報',
		ko: '대설주의보',
	},
	'13': {
		ja: '風雪注意報',
		en: 'a snowstorm advisory',
		'zh-TW': '風雪注意報',
		ko: '풍설주의보',
	},
	'06': {
		ja: '大雪警報',
		en: 'a heavy snow warning',
		'zh-TW': '大雪警報',
		ko: '대설경보',
	},
	'02': {
		ja: '暴風雪警報',
		en: 'a blizzard warning',
		'zh-TW': '暴風雪警報',
		ko: '폭풍설경보',
	},
	'36': {
		ja: '大雪特別警報',
		en: 'a heavy snow emergency warning',
		'zh-TW': '大雪特別警報',
		ko: '대설특별경보',
	},
	'32': {
		ja: '暴風雪特別警報',
		en: 'a blizzard emergency warning',
		'zh-TW': '暴風雪特別警報',
		ko: '폭풍설특별경보',
	},
};

function warningName(code: string, language: GuestLanguage): string {
	return (WARNING_NAMES[code] ?? WARNING_NAMES['06'])![language];
}

function formatDate(isoDate: string, language: GuestLanguage): string {
	const [year, month, day] = isoDate.split('-').map(Number) as [
		number,
		number,
		number,
	];
	const date = new Date(Date.UTC(year, month - 1, day));
	const locale = { ja: 'ja-JP', en: 'en-GB', 'zh-TW': 'zh-TW', ko: 'ko-KR' }[
		language
	];
	return date.toLocaleDateString(locale, {
		timeZone: 'UTC',
		month: language === 'en' ? 'long' : 'numeric',
		day: 'numeric',
		weekday: language === 'en' ? 'long' : 'short',
	});
}

export function draftBody(vars: DraftVars, language: GuestLanguage): string {
	const date = formatDate(vars.arrivalDate, language);
	const warning = warningName(vars.warningCode, language);
	const sign = [vars.innName, vars.innPhone].filter(Boolean).join('\n');
	switch (language) {
		case 'ja':
			return [
				`${vars.guestName}様`,
				'',
				`${vars.innName}です。${date}のご到着について、ご連絡いたします。`,
				`現在、宿のある地域に${warning}が出ています。道路の渋滞や、列車・バスの遅れや運休が起きるおそれがあります。`,
				'',
				'・お出かけの前に、交通機関の最新の運行情報をご確認ください。',
				'・到着が遅くなる場合や、ご予定を変える場合は、お気軽にご連絡ください。',
				'・無理な移動はなさらず、どうぞ安全を第一にお越しください。',
				'',
				'お会いできるのを楽しみにしております。',
				'',
				sign,
			].join('\n');
		case 'en':
			return [
				`Dear ${vars.guestName},`,
				'',
				`This is ${vars.innName}, writing about your arrival on ${date}.`,
				`There is currently ${warning} for our area. Roads may be slow, and trains and buses may be delayed or cancelled.`,
				'',
				'- Please check the latest train and bus information before you set out.',
				'- If you expect to arrive late or want to change your plans, just let us know.',
				'- Please do not take risks on the road. Your safety comes first.',
				'',
				'We look forward to welcoming you.',
				'',
				sign,
			].join('\n');
		case 'zh-TW':
			return [
				`${vars.guestName} 您好：`,
				'',
				`這裡是${vars.innName}，想跟您聯絡關於${date}入住的事。`,
				`目前本館所在地區已發布「${warning}」。道路可能壅塞，火車和巴士也可能延誤或停駛。`,
				'',
				'・出發前，請先確認最新的交通運行資訊。',
				'・如果會晚到，或想更改行程，請隨時與我們聯絡。',
				'・請不要勉強移動，以安全為第一優先。',
				'',
				'期待您的到來。',
				'',
				sign,
			].join('\n');
		case 'ko':
			return [
				`${vars.guestName} 님께`,
				'',
				`${vars.innName}입니다. ${date} 도착 예정과 관련해 연락드립니다.`,
				`현재 저희 숙소가 있는 지역에 ${warning}가 발표되었습니다. 도로가 정체되거나 열차와 버스가 지연 또는 운휴될 수 있습니다.`,
				'',
				'・출발 전에 최신 교통 운행 정보를 확인해 주세요.',
				'・도착이 늦어지거나 일정을 변경하실 경우 편하게 연락 주세요.',
				'・무리한 이동은 피하시고 안전을 최우선으로 해 주세요.',
				'',
				'뵙기를 기대하고 있겠습니다.',
				'',
				sign,
			].join('\n');
	}
}

/** Labels the owner sees for a snow kind (ja/en UI). */
export function kindLabel(kind: SnowKind, locale: 'ja' | 'en'): string {
	return locale === 'ja' ? kind.nameJa : kind.nameEn;
}
