// Staff queue strings (contract §2): a small dictionary keyed by Locale, no
// i18n framework for MVP. The queue itself (including owner contact details)
// is staff-only; signed-out and non-staff visitors only ever see the prompt.
import type { Locale, ReportStatus } from '#shared/types/domain';

export type StaffStrings = {
	eyebrow: string;
	title: string;
	intro: string;
	refresh: string;
	lastRefreshed: string;
	signOut: string;
	loading: string;
	loadError: string;
	retry: string;
	empty: string;
	outboxNotice: string;
	viewReport: string;
	forbidden: {
		title: string;
		body: string;
	};
	signedOut: {
		title: string;
		body: string;
		link: string;
	};
	status: Record<ReportStatus, string>;
	consultation: {
		requested: string;
		none: string;
	};
	columns: {
		business: string;
		owner: string;
		contact: string;
		status: string;
		consultation: string;
		createdAt: string;
		actions: string;
	};
};

export const staffStrings: Record<Locale, StaffStrings> = {
	ja: {
		eyebrow: 'スタッフメニュー',
		title: 'レポート管理キュー',
		intro: '全国の経営者から提出された面談レポートの状況を確認できます。一覧は手動更新です。',
		refresh: '更新',
		lastRefreshed: '最終更新',
		signOut: 'サインアウト',
		loading: '読み込み中…',
		loadError: '一覧の読み込みに失敗しました。',
		retry: '再試行',
		empty: 'まだレポートはありません。',
		outboxNotice:
			'レポート完成時には経営者とスタッフに通知メールが作成されます。既定の配信先はローカル送信フォルダー（.eml ファイル）で、外部には送信されません。ライブ配信はサーバー設定でのみ有効になります。',
		viewReport: 'レポートを見る',
		forbidden: {
			title: 'スタッフ専用ページです',
			body: 'このキューはスタッフアカウントのみが利用できます。',
		},
		signedOut: {
			title: 'スタッフアカウントでサインインしてください',
			body: 'レポートのキューはスタッフ専用です。',
			link: 'サインイン',
		},
		status: {
			pending: '生成中',
			ready: '完成',
			failed: '失敗',
		},
		consultation: {
			requested: '相談申込あり',
			none: '—',
		},
		columns: {
			business: '事業所',
			owner: '経営者',
			contact: '連絡先',
			status: '状態',
			consultation: '相談',
			createdAt: '提出日時',
			actions: '操作',
		},
	},
	en: {
		eyebrow: 'Staff',
		title: 'Report queue',
		intro: 'Track interview reports submitted by business owners. The list refreshes only on request.',
		refresh: 'Refresh',
		lastRefreshed: 'Updated',
		signOut: 'Sign out',
		loading: 'Loading…',
		loadError: 'Could not load the report queue.',
		retry: 'Retry',
		empty: 'No reports yet.',
		outboxNotice:
			'When a report becomes ready, notification mail is prepared for the owner and staff. The default delivery target is the local outbox (.eml files) — nothing is sent externally. Live delivery is enabled only by server configuration.',
		viewReport: 'View report',
		forbidden: {
			title: 'Staff only',
			body: 'This queue is available to staff accounts only.',
		},
		signedOut: {
			title: 'Sign in with a staff account',
			body: 'The report queue is restricted to staff.',
			link: 'Sign in',
		},
		status: {
			pending: 'Generating',
			ready: 'Ready',
			failed: 'Failed',
		},
		consultation: {
			requested: 'Consultation requested',
			none: '—',
		},
		columns: {
			business: 'Business',
			owner: 'Owner',
			contact: 'Contact',
			status: 'Status',
			consultation: 'Consultation',
			createdAt: 'Submitted',
			actions: 'Actions',
		},
	},
};
