// The active Shima catalog contains one fictional task bound to the documented
// hotel fixture. Its public copy is authored separately from private evidence.
import { type PublicTask, PublicTaskSchema } from '../../shared/shima/schemas';
import { publicTaskHash } from '../../shared/shima/hash';

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
	tasks: readonly ShimaCatalogEntry[];
};

// Restricted v1 copy retained verbatim for historical hash verification only.
const HOTEL_ROOM_CHANGE_TASK_V1: PublicTask = {
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

const HOTEL_ROOM_CHANGE_POSTING_V1: ShimaCatalogEntry = {
	key: 'hotel-room-change-posting-v1',
	task: HOTEL_ROOM_CHANGE_TASK_V1,
	binding: {
		clientId: 'cli_hotel_demo',
		sessionId: 'ses_hotel_demo',
		opportunityId: 'opp_hotel_02',
		variant: 'hotel-demo-followup-v1',
	},
};

const SHIMA_ARCHIVED_CATALOG_VERSIONS: readonly ShimaCatalogVersion[] = [
	{ version: 1, tasks: [HOTEL_ROOM_CHANGE_POSTING_V1] },
];

const HOTEL_ROOM_CHANGE_TASK_V2: PublicTask = {
	title: '宿泊施設の客室変更を清掃予定に反映する仕組み',
	problem:
		'客室変更が確定すると、受付から清掃担当へ連絡し、清掃予定を手作業で更新している。連絡や転記が漏れると、清掃担当が変更に気づかないことがある。',
	proposedChange:
		'確定した客室変更だけを、対象日と客室が分かる形で共有の清掃予定に追記する。内容が不明な変更や反映できなかった変更は担当者の確認に回す。',
	deliverables: [
		'確定済みの客室変更を取り込む処理',
		'共有の清掃予定に変更を追記する処理',
		'確認が必要な変更の一覧',
	],
	acceptanceCriteria: [
		'確定済みの架空サンプル10件で、対象日と客室が正しく追記される。',
		'未確定の変更は反映しない。もとの予定を書き換えず、客室を清掃済みにしない。',
		'対象日や客室が不明な変更と、反映に失敗した変更は確認一覧に出る。',
	],
	skills: ['表計算の基本操作', '通知の取り込みと処理の自動化'],
	integrations: ['確定済みの客室変更通知', '共有の清掃予定表'],
	benefits: [
		'繁忙期の連絡・転記をすべて省けた場合、削減できる時間は月最大10時間と試算（週約10件、1件約15分、4週間換算）。実測ではない。',
		'客室変更の見落としを減らすことを目指す。',
	],
	prerequisites: [
		'客室変更の確定が判別でき、対象日と客室を確認できる入力',
		'共有の清掃予定表と、変更を追記する権限',
	],
	limitations: [
		'実際の削減時間は季節ごとの件数や、担当者に残る確認・例外対応にかかる時間によって変わる。',
		'清掃の割り当てや実施は自動化しない。',
	],
	confirmedBudgetYen: 80000,
	targetDate: '2026-12-18',
	estimatedHoursSavedPerMonth: 10,
};

/** Only active versions are eligible for preview, publication, or the board. */
export const SHIMA_CATALOG_VERSIONS: readonly ShimaCatalogVersion[] = [
	{
		version: 2,
		tasks: [{
			key: 'hotel-room-change-posting-v2',
			task: HOTEL_ROOM_CHANGE_TASK_V2,
			binding: HOTEL_ROOM_CHANGE_POSTING_V1.binding,
		}],
	},
];

// The documented owner-reported effort datum of the follow-up variant: the
// reconciled room-change step, ten occurrences per week, fifteen minutes each.
export const SHIMA_EFFORT_STEP_ID = 'step_hotel_08';
export const SHIMA_EFFORT_WEEKLY_OCCURRENCES = 10;
export const SHIMA_EFFORT_MINUTES_PER_OCCURRENCE = 15;

/** Retired and unknown version/key pairs are not resolved for active use. */
export function shimaCatalogEntry(
	catalogVersion: number,
	entryKey: string,
): ShimaCatalogEntry | null {
	return findCatalogEntry(SHIMA_CATALOG_VERSIONS, catalogVersion, entryKey);
}

/** Historical lookup only; never use this to serve or claim a public quest. */
export function shimaArchivedCatalogEntry(
	catalogVersion: number,
	entryKey: string,
): ShimaCatalogEntry | null {
	return findCatalogEntry(SHIMA_ARCHIVED_CATALOG_VERSIONS, catalogVersion, entryKey);
}

/** Reject retired versions and edited or relabeled content without private joins. */
export function matchesActiveShimaCatalogTask(catalogVersion: number, task: unknown): boolean {
	const catalog = SHIMA_CATALOG_VERSIONS.find((candidate) => candidate.version === catalogVersion);
	if (!catalog) {
		return false;
	}
	const parsed = PublicTaskSchema.safeParse(task);
	if (!parsed.success) {
		return false;
	}
	const hash = publicTaskHash(parsed.data);
	return catalog.tasks.some((entry) => publicTaskHash(entry.task) === hash);
}

function findCatalogEntry(
	versions: readonly ShimaCatalogVersion[],
	catalogVersion: number,
	entryKey: string,
): ShimaCatalogEntry | null {
	const catalog = versions.find(
		(candidate) => candidate.version === catalogVersion,
	);
	return catalog?.tasks.find((task) => task.key === entryKey) ?? null;
}
