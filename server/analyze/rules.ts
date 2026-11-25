// Rule-based demo analysis tables (§11): deterministic keyword/section rules
// over the transcript + owner profile snapshot — no network, no AI. Later
// workers can extend TOPICS or add per-type sections without touching the API.
import type { Locale } from '#shared/types/domain';

export type Snapshot = {
	businessName: string;
	municipality: string;
	locale: Locale;
};

export type TopicCopy = { title: string; observation: string; action: string };

export type Topic = {
	id: string;
	keywords: { ja: string[]; en: string[] };
	ja: TopicCopy;
	en: TopicCopy;
};

export const TOPICS: Topic[] = [
	{
		id: 'staffing',
		keywords: {
			ja: [
				'人手',
				'人材',
				'採用',
				'離職',
				'シフト',
				'パート',
				'アルバイト',
				'スタッフ',
				'従業員',
				'働き手',
			],
			en: [
				'staff',
				'hiring',
				'turnover',
				'understaff',
				'recruit',
				'shift',
				'employee',
				'labor',
				'labour',
			],
		},
		ja: {
			title: '人材の確保と定着',
			observation:
				'面談の中で人手不足や採用・労務に関する話題が確認されました。',
			action: '市と商工団体の雇用支援制度や職業紹介窓口に相談し、求人条件・働き方・業務の見直しを一緒に整理しましょう。',
		},
		en: {
			title: 'Staffing and retention',
			observation:
				'The interview touched on understaffing, hiring or labor conditions.',
			action: 'Ask the municipal commerce desk about employment support programs and review job conditions and working styles together.',
		},
	},
	{
		id: 'seasonality',
		keywords: {
			ja: [
				'繁忙',
				'閑散',
				'季節',
				'オフシーズン',
				'平日',
				'週末',
				'冬季',
				'夏季',
				'雪',
				'観光シーズン',
			],
			en: [
				'season',
				'off-season',
				'peak',
				'weekday',
				'weekend',
				'winter',
				'summer',
				'green season',
			],
		},
		ja: {
			title: '繁忙期・閑散期の平準化',
			observation:
				'売上や来訪が季節・曜日によって大きく変わることが確認されました。',
			action: '閑散期・平日期向けのプランや地域イベントとの連動企画を評価し、通年の収益バランスを窓口で試算してもらいましょう。',
		},
		en: {
			title: 'Smoothing peak and off-seasons',
			observation:
				'Revenue or visits clearly vary by season or day of week.',
			action: 'Evaluate off-season plans and tie-ups with local events, and have the support desk review your year-round balance.',
		},
	},
	{
		id: 'customers',
		keywords: {
			ja: [
				'集客',
				'顧客',
				'お客',
				'リピート',
				'口コミ',
				'宣伝',
				'広告',
				'観光客',
				'来店',
				'来場',
			],
			en: [
				'customer',
				'marketing',
				'review',
				'repeat',
				'advert',
				'social',
				'visitor',
				'guest',
			],
		},
		ja: {
			title: '集客と顧客との関係',
			observation:
				'顧客の流れ（リピート・口コミ・広告など）についての話題が確認されました。',
			action: '既存顧客の声を整理した上で、市の販路開拓支援やSNS・HPの導入補助の対象になるか窓口に確認しましょう。',
		},
		en: {
			title: 'Customer acquisition and relationships',
			observation:
				'The interview covered customer flows such as repeats, reviews or advertising.',
			action: 'Summarize what existing customers say, then check municipal sales-channel and website support programs.',
		},
	},
	{
		id: 'pricing',
		keywords: {
			ja: ['料金', '価格', '値段', '値上げ', '単価', '原価', 'コスト'],
			en: ['price', 'pricing', 'rate', 'cost', 'margin', 'fee'],
		},
		ja: {
			title: '料金・価格の見直し',
			observation: '料金設定や原価に関する悩みが確認されました。',
			action: '同業種の相場と自分の原価を一覧にし、小さな値上げ・プラン分化を試す前提で専門家相談を予約しましょう。',
		},
		en: {
			title: 'Pricing review',
			observation: 'Concerns about pricing or costs were mentioned.',
			action: 'List competitor prices and your own costs, then book an expert consultation before testing small price steps.',
		},
	},
	{
		id: 'digital',
		keywords: {
			ja: [
				'予約',
				'ウェブ',
				'web',
				'サイト',
				'インターネット',
				'デジタル',
				'sns',
				'line',
				'メール',
				'電話対応',
				'システム',
			],
			en: [
				'website',
				'online',
				'digital',
				'booking',
				'reservation',
				'internet',
				'system',
			],
		},
		ja: {
			title: '予約・受注のデジタル化',
			observation:
				'予約や受注の経路が電話・対面中心であることへの課題が確認されました。',
			action: '市のデジタル化支援やEC・予約システム導入の補助制度の対象になるか、商工団体経由で確認しましょう。',
		},
		en: {
			title: 'Digital booking and order channels',
			observation:
				'Booking or ordering still runs mainly by phone or in person.',
			action: 'Check municipal digitalization grants and booking-system support through the commerce desk.',
		},
	},
	{
		id: 'finance',
		keywords: {
			ja: [
				'資金',
				'借入',
				'融資',
				'補助金',
				'売上',
				'利益',
				'経費',
				'請求',
				'支払',
				'設備投資',
			],
			en: [
				'loan',
				'grant',
				'subsidy',
				'revenue',
				'profit',
				'expense',
				'cash',
				'investment',
			],
		},
		ja: {
			title: '資金繰りと経営改善',
			observation: '資金・売上・利益に関する話題が確認されました。',
			action: '経営改善計画書の作成支援と融資・補助の窓口を一度に確認できる「経営改善セミナー」等の案内を受け取りましょう。',
		},
		en: {
			title: 'Cash flow and business improvement',
			observation: 'The interview covered funding, revenue or profit.',
			action: 'Ask for guidance on business-improvement planning plus loan and subsidy desks in one visit.',
		},
	},
	{
		id: 'goals',
		keywords: {
			ja: [
				'目標',
				'計画',
				'将来',
				'来年',
				'拡大',
				'新規',
				'継承',
				'後継',
				'夢',
				'挑戦',
			],
			en: [
				'goal',
				'plan',
				'future',
				'next year',
				'expand',
				'succession',
				'dream',
			],
		},
		ja: {
			title: '今後の目標と事業展開',
			observation:
				'今後の目標や展開についての前向きな話題が確認されました。',
			action: '目標を「3か月でできる一歩」に分解し、窓口の伴走支援（経営相談会・専門家紹介）を活用しましょう。',
		},
		en: {
			title: 'Goals and next steps for the business',
			observation:
				'The interview mentioned forward-looking goals or plans.',
			action: 'Break the goal into one three-month step and use the accompanying support at the desk (consultations, expert referral).',
		},
	},
];

// ---------------------------------------------------------------------------
// Decision-ready recommendation templates (additive §11 rules). One template
// per business type: the accommodation entry is the inn recommendation
// (booking calendar -> cleaning list); every other type shares the adapted
// generic template. All copy is explicitly labeled as rule-based examples and
// estimates in the rendered report, so nothing is presented as an observed
// fact from the interview.
// ---------------------------------------------------------------------------

export type Bilingual = { ja: string; en: string };

export type BilingualList = { ja: string[]; en: string[] };

export type OpsRecommendation = {
	/** Blockquote under the flow comparison heading. */
	flowExampleLabel: Bilingual;
	/** Ordered steps: the current (template) way of working. */
	currentSteps: BilingualList;
	/** Ordered steps: the improved way of working. */
	improvedSteps: BilingualList;
	/** Extra bottleneck line, shown only when the digital topic matched. */
	bottleneckExtra: Bilingual | null;
	/** Time savings bullets; ends with the estimate label line. */
	timeSavings: BilingualList;
	/** Implementation workload bullets; ends with the estimate label line. */
	workload: BilingualList;
	/** Indicative cost bullets (JPY); ends with the estimate label line. */
	costs: BilingualList;
	/** Off-the-shelf vs custom recommendation bullets. */
	buildVsBuy: BilingualList;
};

const ESTIMATE_LABEL_JA = '分類: ルールベースの推定';
const ESTIMATE_LABEL_EN = 'Classification: rule-based estimate';

const INN_RECOMMENDATION: OpsRecommendation = {
	flowExampleLabel: {
		ja: '例示です。面談の記録で確認できた内容ではありません。（ルールベース）',
		en: 'Examples only — not facts confirmed in the interview. (rule-based)',
	},
	currentSteps: {
		ja: [
			'電話で予約を受ける',
			'手書きの予約表に転記する',
			'前日に清掃の担当と開始時刻を口頭で決める',
			'当日、客室を清掃して迎える',
		],
		en: [
			'Take bookings by phone',
			'Copy them into a handwritten booking sheet',
			'Arrange cleaning staff and start times verbally the day before',
			'Clean the rooms on the day',
		],
	},
	improvedSteps: {
		ja: [
			'Web予約カレンダーで予約を受け、空き室と自動で連動させる',
			'予約がそのまま清掃リストに追加される',
			'前日に清掃リストで担当・客室・時刻を確認する',
			'当日、清掃リストに沿って客室を整える',
		],
		en: [
			'Take bookings on a web booking calendar, synced with room availability',
			'Each booking is added to the cleaning list automatically',
			'Check the cleaning list the day before: who cleans which room, when',
			'Get the rooms ready following the cleaning list on the day',
		],
	},
	bottleneckExtra: {
		ja: '予約のたびに手書きへの転記と口頭での清掃手配が発生し、確認の手間が重なります。',
		en: 'Every booking adds handwriting transcription and verbal cleaning arrangements, stacking up checking work.',
	},
	timeSavings: {
		ja: [
			'予約1件あたりの転記・連絡・手配の確認作業: 約5分減らせる可能性があります（推定）。',
			'1日5件と仮定すると、月あたり約10時間の削減が見込まれます（推定）。',
			'前提: 予約が現在は電話や手書き中心であること。実際の件数と時間は事業により異なります。',
			ESTIMATE_LABEL_JA,
		],
		en: [
			'Transcription, phone tag and dispatch checks per booking: about 5 minutes less (estimate).',
			'Assuming 5 bookings per day, that is about 10 hours per month (estimate).',
			'Assumption: bookings are currently taken by phone or on paper. Actual volumes and times differ by business.',
			ESTIMATE_LABEL_EN,
		],
	},
	workload: {
		ja: [
			'初期設定: カレンダーと客室の登録など、全体で約2〜4時間の目安。',
			'日々の運用: 予約の記録は自動。前日のリスト確認は数分の目安。',
			'スタッフや家族への使い方の説明: 30分程度の目安。',
			`${ESTIMATE_LABEL_JA}（実際の作業量は構成により変わります）`,
		],
		en: [
			'Initial setup: registering the calendar and rooms, about 2 to 4 hours in total (indicative).',
			'Daily operation: bookings are logged automatically; checking the list takes a few minutes (indicative).',
			'Briefing staff or family on how to use it: about 30 minutes (indicative).',
			`${ESTIMATE_LABEL_EN} (actual workload depends on your setup)`,
		],
	},
	costs: {
		ja: [
			'既製品の予約カレンダー・予約システム: 初期費用 0円〜3万円、月額 0円〜1万円程度（概算）。',
			'無料プランから始めて、必要になった時点で有料プランへ移る段階的な導入も可能です。',
			`${ESTIMATE_LABEL_JA}（最新の価格は各サービスの公式情報で確認してください）`,
		],
		en: [
			'Off-the-shelf booking calendar / booking system: initial 0-30,000 JPY, monthly 0-10,000 JPY (indicative).',
			'You can start on a free plan and move to a paid plan only when it becomes necessary.',
			`${ESTIMATE_LABEL_EN} (check current prices with each provider)`,
		],
	},
	buildVsBuy: {
		ja: [
			'まず既製品の予約カレンダーで試すのが妥当な見込みです（当面は独自開発が必要になる可能性は低い）。',
			'判断の目安: 標準機能で足りない操作が毎日発生するようになったら、個別開発や有料オプションを検討します。',
		],
		en: [
			'Starting with an off-the-shelf booking calendar is a reasonable first step (custom development is unlikely to be needed for now).',
			'Rule of thumb: consider custom development or paid options once missing features start to affect daily work.',
		],
	},
};

const GENERIC_RECOMMENDATION: OpsRecommendation = {
	flowExampleLabel: INN_RECOMMENDATION.flowExampleLabel,
	currentSteps: {
		ja: [
			'電話や対面で予約・受注を受ける',
			'受付内容を手書きの台帳に書き写す',
			'前日に必要な作業や仕入れを口頭で決める',
			'当日、作業や提供を行う',
		],
		en: [
			'Take bookings and orders by phone or in person',
			'Copy the details into a paper ledger',
			"Arrange the next day's tasks and supplies verbally",
			'Carry out the work or service on the day',
		],
	},
	improvedSteps: {
		ja: [
			'Webの予約・受注カレンダーで受付する（空き状況と自動で連動）',
			'受付内容がそのまま作業リスト（仕入れ・仕込み・対応など）に追加される',
			'前日にリストで担当と内容を確認する',
			'当日、リストに沿って作業や提供を行う',
		],
		en: [
			'Take bookings and orders on a web calendar (synced with availability)',
			'Accepted details are added to the task list (supplies, preparation, follow-ups) automatically',
			'Check the list the day before: who does what',
			'Carry out the work or service following the list on the day',
		],
	},
	bottleneckExtra: {
		ja: '受注や予約のたびに手書きへの転記と口頭での手配が発生し、確認の手間が重なります。',
		en: 'Every order or booking adds handwriting transcription and verbal arrangements, stacking up checking work.',
	},
	timeSavings: {
		ja: [
			'予約・受注1件あたりの転記・連絡・手配の確認作業: 約5分減らせる可能性があります（推定）。',
			'1日5件と仮定すると、月あたり約10時間の削減が見込まれます（推定）。',
			'前提: 予約や受注が現在は電話や手書き中心であること。実際の件数と時間は事業により異なります。',
			ESTIMATE_LABEL_JA,
		],
		en: [
			'Transcription, phone tag and dispatch checks per order: about 5 minutes less (estimate).',
			'Assuming 5 orders per day, that is about 10 hours per month (estimate).',
			'Assumption: bookings and orders are currently taken by phone or on paper. Actual volumes and times differ by business.',
			ESTIMATE_LABEL_EN,
		],
	},
	workload: INN_RECOMMENDATION.workload,
	costs: {
		ja: [
			'既製品の予約・受注管理ツール: 初期費用 0円〜3万円、月額 0円〜1万円程度（概算）。',
			'無料プランから始めて、必要になった時点で有料プランへ移る段階的な導入も可能です。',
			`${ESTIMATE_LABEL_JA}（最新の価格は各サービスの公式情報で確認してください）`,
		],
		en: [
			'Off-the-shelf booking / order management tool: initial 0-30,000 JPY, monthly 0-10,000 JPY (indicative).',
			'You can start on a free plan and move to a paid plan only when it becomes necessary.',
			`${ESTIMATE_LABEL_EN} (check current prices with each provider)`,
		],
	},
	buildVsBuy: {
		ja: [
			'まず既製品の予約・受注管理ツールで試すのが妥当な見込みです（当面は独自開発が必要になる可能性は低い）。',
			'判断の目安: 標準機能で足りない操作が毎日発生するようになったら、個別開発や有料オプションを検討します。',
		],
		en: [
			'Starting with an off-the-shelf booking / order management tool is a reasonable first step (custom development is unlikely to be needed for now).',
			'Rule of thumb: consider custom development or paid options once missing features start to affect daily work.',
		],
	},
};

export function opsFor(): OpsRecommendation {
	return GENERIC_RECOMMENDATION;
}
