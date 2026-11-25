// Shell-layer bilingual dictionary (app shell + owner entry pages only).
// Other pages keep their own dictionaries; they share the Locale type via
// #shared/types/domain. ja is the source of truth: shellEn is typed as
// typeof shellJa so the two trees can never drift apart in key structure.
// Type-only imports are erased at runtime, so this file also loads in plain
// Node for tests/shell-contracts.test.mjs.
import type { Locale } from '#shared/types/domain';

const shellJa = {
	brand: '女将の右腕',
	brandSub: '北海道の中小事業者支援パイロット',
	metaDescription:
		'北海道の中小事業者のための経営相談サービス。面談でお話しした内容から、専任スタッフと共有できる経営レポートを作成します。',
	skipToContent: '本文へスキップ',
	localeSwitchLabel: '表示言語を切り替え',
	nav: {
		signup: '新規登録',
		signIn: 'サインイン',
		signOut: 'ログアウト',
		interview: '面談を始める',
		staff: '管理画面',
	},
	footerNote: '女将の右腕 — 北海道の中小事業者支援パイロット',
	footerDemo:
		'これはデモ環境です。面談はサンプル（フィクション）、レポートはルールベースの自動下書きです。',
	home: {
		eyebrow: '北海道の中小事業者のみなさまへ',
		title: '経営の悩みを、\n話すだけで形に。',
		lead: '面談でお話しした内容をもとに、経営レポートを作成します。市区町村の支援窓口と相談したいときも、レポートをそのままお持ちいただけます。',
		ctaSignup: '新規登録して始める',
		ctaSignIn: 'サインイン',
		startOwnerTitle: '面談の準備ができています',
		ctaStartOwner: '面談を始める',
		ctaStartOwnerHint: 'サインイン後に面談ページへ進みます。',
		stepsTitle: '利用の流れ',
		steps: [
			{
				title: 'アカウントを作る',
				body: 'メールアドレスとパスワード、事業所の基本情報だけで登録できます。',
			},
			{
				title: '面談で話す',
				body: '専用ページで面談を行います。開始から1時間以内に内容を確定してください。',
			},
			{
				title: 'レポートを受け取る',
				body: '内容から経営レポートを作成し、完成したらメールでお知らせします。相談の申込もワンクリックです。',
			},
		],
		demoNote:
			'現在ご利用いただける面談は「サンプル面談（フィクション）」です。登場人物とやり取りは架空のものです。',
		mascotAlt: 'シマエナガのマスコットキャラクター',
	},
	signup: {
		eyebrow: '新規登録',
		title: 'アカウントを作成',
		lead: 'メールアドレスとパスワード、事業所の基本情報だけで始められます。',
		fields: {
			email: { label: 'メールアドレス' },
			password: {
				label: 'パスワード',
				hint: '8文字以上で入力してください。',
			},
			name: { label: 'お名前' },
			businessName: { label: '事業所名' },
			businessType: {
				label: '事業種別',
				placeholder: '選択してください',
			},
			otherBusinessType: {
				label: '事業種別の詳細',
				requiredNote: '（その他を選んだ場合は必須）',
				placeholder: '例：手作り菓子の販売',
			},
			municipality: { label: '市区町村', hint: '例：岩見沢市' },
			phone: { label: '電話番号' },
			website: { label: 'ウェブサイト' },
			note: { label: '相談したいこと（自由記入）' },
			locale: { label: '登録言語', ja: '日本語', en: 'English' },
		},
		optionalMark: '（任意）',
		submit: '登録する',
		submitting: '送信中…',
		signinLink: 'すでにアカウントをお持ちの方はサインインへ',
		errors: {
			validation: '入力内容を確認してください。',
			email_taken: 'このメールアドレスは既に使われています。',
			network: '通信できませんでした。もう一度お試しください。',
		},
		businessTypes: {
			accommodation: '宿泊業',
			food_service: '飲食業',
			retail: '小売業',
			tourism: '観光業',
			agriculture: '農業',
			manufacturing: '製造業',
			construction: '建設業',
			transport: '運輸業',
			healthcare: '医療・福祉',
			professional_services: '専門サービス業',
			other: 'その他',
		},
	},
	signin: {
		eyebrow: 'サインイン',
		title: 'サインイン',
		lead: '登録済みのメールアドレスでサインインします。',
		fields: {
			email: { label: 'メールアドレス' },
			password: { label: 'パスワード' },
		},
		submit: 'サインイン',
		submitting: '確認中…',
		signupLink: 'アカウントをお持ちでない方は新規登録へ',
		errors: {
			invalid_credentials: 'メールアドレスまたはパスワードが違います。',
			network: '通信できませんでした。もう一度お試しください。',
		},
	},
};

export type ShellMessages = typeof shellJa;

const shellEn: ShellMessages = {
	brand: 'Okami no Migiude',
	brandSub: 'Municipal SMB support pilot — Hokkaido',
	metaDescription:
		'Business consultation for small and mid-sized businesses in Hokkaido. Your interview becomes a management report you can take to the municipal support desk.',
	skipToContent: 'Skip to content',
	localeSwitchLabel: 'Switch display language',
	nav: {
		signup: 'Sign up',
		signIn: 'Sign in',
		signOut: 'Sign out',
		interview: 'Start interview',
		staff: 'Staff console',
	},
	footerNote: 'Okami no Migiude — a municipal SMB support pilot for Hokkaido',
	footerDemo:
		'This is a demo environment. Interviews are a sample (fictional) and reports are a rule-based automated draft.',
	home: {
		eyebrow: 'For small and mid-sized businesses in Hokkaido',
		title: 'Talk it through.\nWe turn it into a plan.',
		lead: 'Tell us about your business in a short interview — we turn it into a management report you can take straight to the municipal support desk.',
		ctaSignup: 'Sign up to get started',
		ctaSignIn: 'Sign in',
		startOwnerTitle: 'Ready to start your interview',
		ctaStartOwner: 'Start the interview',
		ctaStartOwnerHint:
			'You will continue on the interview page after signing in.',
		stepsTitle: 'How it works',
		steps: [
			{
				title: 'Create your account',
				body: 'Sign up with just an email address, a password, and your basic business details.',
			},
			{
				title: 'Have the interview',
				body: 'Use the interview page to tell your story. Finalize it within the one-hour window.',
			},
			{
				title: 'Receive your report',
				body: 'We generate a management report and notify you by email when it is ready. Requesting a consultation takes one click.',
			},
		],
		demoNote:
			'The interview currently offered is a "Sample interview (fictional)". The persona and dialogue are fictional.',
		mascotAlt: 'Shima Enaga mascot',
	},
	signup: {
		eyebrow: 'Sign up',
		title: 'Create your account',
		lead: 'Start with just an email address, a password, and your basic business details.',
		fields: {
			email: { label: 'Email address' },
			password: {
				label: 'Password',
				hint: 'Use at least 8 characters.',
			},
			name: { label: 'Your name' },
			businessName: { label: 'Business name' },
			businessType: {
				label: 'Business type',
				placeholder: 'Select one',
			},
			otherBusinessType: {
				label: 'Describe your business type',
				requiredNote: '(required when "Other" is selected)',
				placeholder: 'e.g. Handmade sweets stall',
			},
			municipality: {
				label: 'Municipality',
				hint: 'e.g. Iwamizawa City',
			},
			phone: { label: 'Phone number' },
			website: { label: 'Website' },
			note: {
				label: 'What would you like to consult about? (free text)',
			},
			locale: {
				label: 'Profile language',
				ja: 'Japanese',
				en: 'English',
			},
		},
		optionalMark: ' (optional)',
		submit: 'Create account',
		submitting: 'Submitting…',
		signinLink: 'Already have an account? Sign in',
		errors: {
			validation: 'Please check the form values.',
			email_taken: 'This email address is already registered.',
			network: 'Network error. Please try again.',
		},
		businessTypes: {
			accommodation: 'Accommodation',
			food_service: 'Food service',
			retail: 'Retail',
			tourism: 'Tourism',
			agriculture: 'Agriculture',
			manufacturing: 'Manufacturing',
			construction: 'Construction',
			transport: 'Transport',
			healthcare: 'Healthcare & welfare',
			professional_services: 'Professional services',
			other: 'Other',
		},
	},
	signin: {
		eyebrow: 'Sign in',
		title: 'Sign in',
		lead: 'Sign in with your registered email address.',
		fields: {
			email: { label: 'Email address' },
			password: { label: 'Password' },
		},
		submit: 'Sign in',
		submitting: 'Checking…',
		signupLink: 'No account yet? Create one',
		errors: {
			invalid_credentials: 'The email address or password is incorrect.',
			network: 'Network error. Please try again.',
		},
	},
};

export const shellMessages: Record<Locale, ShellMessages> = {
	ja: shellJa,
	en: shellEn,
};
