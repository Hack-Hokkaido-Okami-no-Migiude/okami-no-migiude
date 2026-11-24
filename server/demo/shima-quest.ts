// The checked-in Shima catalog: exactly one fictional task, bound to the
// documented hotel fixture. The public prose lives here in source — it is a
// separately written, anonymized representation, never derived from or copied
// out of a private transcript at request time.
import type { PublicTask } from '../../shared/shima/schemas';

export type ShimaCatalogEntry = {
	/** Stable key used by previews and stored quests to cite the catalog. */
	key: string;
	task: PublicTask;
	binding: {
		clientId: string;
		sessionId: string;
		opportunityId: string;
		variant: string;
	};
};

export type ShimaCatalogVersion = {
	version: number;
	tasks: ShimaCatalogEntry[];
};

const HOTEL_ROOM_CHANGE_TASK: PublicTask = {
	title: '佐渡島の宿：予約変更を清掃計画へ自動反映する連携',
	problem:
		'変更のたびに予約管理システム「YukiReserve」のメールボックスを確認し、清掃スタッフが共有するExcelの清掃予定表へ手作業で反映している。繁忙期は週10件程度の変更が重なり、1件あたり約15分の転記と、未反映のまま清掃が進んでしまう事故が続いている。',
	proposedChange:
		'予約変更メールを検知したら、対象の客室と日付を抽出して共有清掃予定表へ自動登録する。登録内容は担当者へ通知され、Excel側の上書きとは別セルで管理するため、現行の入力済み予定は壊さない。',
	deliverables: [
		'変更メールの取込と客室・日付の抽出',
		'共有清掃予定表への自動登録（新規セル）',
		'登録結果の担当者通知',
	],
	acceptanceCriteria: [
		'サンプルの変更メール10件が正しい客室・日付で登録される',
		'既存の予定セルを書き換えない',
	],
	skills: ['Google Apps Script', '表計算の基本的な操作'],
	integrations: ['YukiReserve（メール通知）', 'Google スプレッドシート'],
	benefits: [
		'繁忙期の清掃予定入力を週2.5時間削減',
		'転記漏れによる清掃事故の防止',
		'清掃スタッフが予定をリアルタイムで確認できる',
	],
	prerequisites: [
		'Google スプレッドシートの利用（現行のExcelの複製）',
		'YukiReserveの通知メールの転送設定',
	],
	limitations: [
		'日本語の通知メール形式が変わった場合は要調整',
		'YukiReserveにAPI連携がなく、メール通知での実装になる',
	],
	confirmedBudgetYen: 80000,
	targetDate: '2026-12-18',
	estimatedHoursSavedPerMonth: 10,
};

const HOTEL_ROOM_CHANGE_POSTING: ShimaCatalogEntry = {
	key: 'hotel-room-change-posting-v1',
	task: HOTEL_ROOM_CHANGE_TASK,
	binding: {
		clientId: 'cli_hotel_demo',
		sessionId: 'ses_hotel_demo',
		opportunityId: 'opp_hotel_02',
		variant: 'hotel-demo-followup-v1',
	},
};

export const SHIMA_CATALOG_VERSIONS: readonly ShimaCatalogVersion[] = [
	{ version: 1, tasks: [HOTEL_ROOM_CHANGE_POSTING] },
];

// The documented owner-reported effort datum of the follow-up variant: the
// reconciled room-change step, ten occurrences per week, fifteen minutes each.
export const SHIMA_EFFORT_STEP_ID = 'step_hotel_08';
export const SHIMA_EFFORT_WEEKLY_OCCURRENCES = 10;
export const SHIMA_EFFORT_MINUTES_PER_OCCURRENCE = 15;

/**
 * The catalog entry for a version/key pair, or null when either is unknown.
 * Stored previews and quests cite the pair so a catalog change never silently
 * rewrites already-published content.
 */
export function shimaCatalogEntry(
	catalogVersion: number,
	entryKey: string,
): ShimaCatalogEntry | null {
	const catalog = SHIMA_CATALOG_VERSIONS.find(
		(candidate) => candidate.version === catalogVersion,
	);
	return catalog?.tasks.find((task) => task.key === entryKey) ?? null;
}
