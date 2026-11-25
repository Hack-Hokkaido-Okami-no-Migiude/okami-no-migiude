// Strings for the snow-day page (/snow). ja and en, like the rest of the app.
import type { Locale } from '#shared/types/domain';

type SnowStrings = {
	eyebrow: string;
	title: string;
	intro: string;
	signedOut: string;
	signInLink: string;
	forbidden: string;
	loading: string;
	loadError: string;
	retry: string;
	weatherTitle: string;
	areaLabel: string;
	areaUnknown: (municipality: string) => string;
	unavailable: string;
	noSnow: string;
	snowActive: string;
	issuedAt: string;
	source: string;
	draftFromJma: string;
	simulate: string;
	simulateHint: string;
	draftsCreated: (count: number) => string;
	noneToDraft: string;
	guestsTitle: string;
	guestsIntro: string;
	today: string;
	tomorrow: string;
	nights: (n: number) => string;
	arrivesBy: string;
	contact: string;
	sampleBadge: string;
	noGuests: string;
	loadSamples: string;
	loadSamplesHint: string;
	noMessage: string;
	status: Record<'draft' | 'approved' | 'sent', string>;
	simulatedBadge: string;
	jmaBadge: string;
	messageLabel: (language: string) => string;
	showGloss: string;
	hideGloss: string;
	glossNote: string;
	save: string;
	approve: string;
	send: string;
	discard: string;
	sentNote: string;
	approvalNote: string;
	addGuestTitle: string;
	guestName: string;
	language: string;
	arrivalDate: string;
	nightsLabel: string;
	country: string;
	add: string;
	languages: Record<'ja' | 'en' | 'zh-TW' | 'ko', string>;
	actionError: string;
};

export const snowStrings: Record<Locale, SnowStrings> = {
	ja: {
		eyebrow: '雪の日の連絡',
		title: '雪の日、お客様に連絡する',
		intro: '宿のある地域に大雪の警報や注意報が出たら、今日・明日に着くお客様それぞれの言葉で、連絡の下書きを作ります。女将さんが読んで承認したものだけを送ります。',
		signedOut: 'このページを使うには、事業者としてログインしてください。',
		signInLink: 'ログインする',
		forbidden: 'このページは事業者のアカウント専用です。',
		loading: '読み込んでいます…',
		loadError: '読み込めませんでした。',
		retry: 'もう一度',
		weatherTitle: '気象庁の警報・注意報',
		areaLabel: '対象の地域',
		areaUnknown: (m) =>
			`登録の市町村「${m}」を気象庁の地域で見つけられませんでした。デモの試しボタンは使えます。`,
		unavailable:
			'いま気象庁のデータを取得できません。少し待ってから開き直してください。デモの試しボタンは使えます。',
		noSnow: '現在、雪に関する警報・注意報は出ていません。',
		snowActive: '発表中',
		issuedAt: '気象庁の発表',
		source: '出典：気象庁ホームページ',
		draftFromJma: 'この警報をもとに下書きを作る',
		simulate: 'デモ：大雪警報が出たことにする',
		simulateHint:
			'本番の天気に左右されずに流れを見せるためのボタンです。作られる下書きには「デモ」と表示されます。',
		draftsCreated: (n) =>
			`${n}件の下書きを作りました。内容を確かめて承認してください。`,
		noneToDraft:
			'新しく下書きを作るお客様はいませんでした（すでに下書きがあるか、今日・明日の到着がありません）。',
		guestsTitle: '今日・明日に到着するお客様',
		guestsIntro: '下書きは、お客様が予約のときに選んだ言葉で作られます。',
		today: '今日',
		tomorrow: '明日',
		nights: (n) => `${n}泊`,
		arrivesBy: '交通手段',
		contact: '連絡先',
		sampleBadge: '見本',
		noGuests: '今日・明日に到着するお客様はまだ登録されていません。',
		loadSamples: '見本のお客様を入れる（4組・4言語）',
		loadSamplesHint:
			'架空のお客様です。入れ直すと、前の見本と下書きは消えます。',
		noMessage: 'まだ連絡の下書きはありません。',
		status: {
			draft: '下書き',
			approved: '承認済み・未送信',
			sent: '送信済み',
		},
		simulatedBadge: 'デモの警報',
		jmaBadge: '気象庁の警報',
		messageLabel: (l) => `お客様への連絡（${l}）`,
		showGloss: '日本語で内容を見る',
		hideGloss: '日本語訳を閉じる',
		glossNote: '最初の下書きの日本語訳です。編集した部分は反映されません。',
		save: '文面を保存',
		approve: '読んで確認したので承認する',
		send: '送る',
		discard: '取り消す',
		sentNote:
			'デモのため、実際には届けず、アプリの中の送信記録（guest-outbox）に保存しました。',
		approvalNote: '承認していない下書きは送れません。',
		addGuestTitle: 'お客様を追加する',
		guestName: 'お名前',
		language: '連絡する言葉',
		arrivalDate: '到着日',
		nightsLabel: '泊数',
		country: '国・地域（任意）',
		add: '追加する',
		languages: {
			ja: '日本語',
			en: '英語',
			'zh-TW': '繁体字中国語',
			ko: '韓国語',
		},
		actionError:
			'うまくいきませんでした。画面を開き直してから、もう一度お試しください。',
	},
	en: {
		eyebrow: 'Snow-day messages',
		title: 'Snow day: message your guests',
		intro: "When a heavy snow warning or advisory is issued for your area, this drafts a message to each guest arriving today or tomorrow, in the guest's own language. Only messages you have read and approved are sent.",
		signedOut: 'Sign in as a business owner to use this page.',
		signInLink: 'Sign in',
		forbidden: 'This page is for business owner accounts.',
		loading: 'Loading…',
		loadError: 'Could not load the page.',
		retry: 'Try again',
		weatherTitle: 'JMA warnings and advisories',
		areaLabel: 'Area',
		areaUnknown: (m) =>
			`Could not find your municipality "${m}" among JMA areas. The demo button still works.`,
		unavailable:
			'JMA data cannot be reached right now. Please reopen the page in a moment. The demo button still works.',
		noSnow: 'No snow warnings or advisories are in force right now.',
		snowActive: 'in force',
		issuedAt: 'Issued by JMA',
		source: 'Source: Japan Meteorological Agency website',
		draftFromJma: 'Draft messages for this warning',
		simulate: 'Demo: simulate a heavy snow warning',
		simulateHint:
			'Shows the flow without depending on the real weather. Drafts made this way are labelled as demo.',
		draftsCreated: (n) =>
			`Drafted ${n} message${n === 1 ? '' : 's'}. Please check and approve them.`,
		noneToDraft:
			'No new drafts were needed (every guest already has one, or nobody arrives today or tomorrow).',
		guestsTitle: 'Guests arriving today and tomorrow',
		guestsIntro:
			'Each draft is written in the language the guest chose when booking.',
		today: 'Today',
		tomorrow: 'Tomorrow',
		nights: (n) => `${n} night${n === 1 ? '' : 's'}`,
		arrivesBy: 'Arriving by',
		contact: 'Contact',
		sampleBadge: 'Sample',
		noGuests: 'No guests arriving today or tomorrow yet.',
		loadSamples: 'Load sample guests (4 guests, 4 languages)',
		loadSamplesHint:
			'Fictional guests. Loading again replaces the earlier samples and their drafts.',
		noMessage: 'No message drafted yet.',
		status: {
			draft: 'Draft',
			approved: 'Approved, not sent',
			sent: 'Sent',
		},
		simulatedBadge: 'Demo warning',
		jmaBadge: 'JMA warning',
		messageLabel: (l) => `Message to the guest (${l})`,
		showGloss: 'Show in English',
		hideGloss: 'Hide the English version',
		glossNote:
			'English version of the original draft. Your edits are not reflected here.',
		save: 'Save text',
		approve: 'I have read it: approve',
		send: 'Send',
		discard: 'Discard',
		sentNote:
			'Demo: not delivered to the guest. Saved to the local send log (guest-outbox) inside the app.',
		approvalNote: 'A draft cannot be sent before it is approved.',
		addGuestTitle: 'Add a guest',
		guestName: 'Name',
		language: 'Message language',
		arrivalDate: 'Arrival date',
		nightsLabel: 'Nights',
		country: 'Country or region (optional)',
		add: 'Add',
		languages: {
			ja: 'Japanese',
			en: 'English',
			'zh-TW': 'Traditional Chinese',
			ko: 'Korean',
		},
		actionError: 'That did not work. Please reopen the page and try again.',
	},
};
