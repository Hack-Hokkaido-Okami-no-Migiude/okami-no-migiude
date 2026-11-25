// Structured report content tests (unit level, no server needed).
//
// Spec under test:
// - server/analyze produces the decision-ready report Markdown with reliable
//   headings and explicit conventions (the additive approved approach), in
//   Japanese and English, labeled as rule-based examples/estimates.
// - app/utils/report-content parses that Markdown safely into structured data
//   for the report page, and degrades gracefully for legacy/arbitrary text.
// - app/locales/report-* dictionaries keep ja/en key parity.
//
// Run: node --test tests/report-content.test.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { resolve } from './report-ts-hook.mjs';

registerHooks({ resolve });

const ACCOMMODATION_SNAPSHOT = {
	businessName: 'ペンション木もれび',
	municipality: 'ニセコ町',
	locale: 'ja',
};

const EN_SNAPSHOT = {
	businessName: 'Komorebi Guesthouse',
	businessType: 'accommodation',
	municipality: 'Kutchan Town',
	locale: 'en',
};

const FOOD_SNAPSHOT = {
	businessName: 'キッチン遊び場',
	municipality: '岩見沢市',
	locale: 'ja',
};

const GENERATED_AT = '2026-11-25T09:00:00.000Z';

// Fictional demo transcripts (labeled scripted substitute, contract §11).
// Deliberately different wording from tests/api-journey.test.mjs.
const TRANSCRIPT_JA = [
	'面接者: 本日はよろしくお願いします。事業の現状から教えてください。',
	'経営者: はい。ペンション木もれびです。客室は8室、冬と夏に予約が集中します。',
	'面接者: 課題をお聞かせください。',
	'経営者: 清掃スタッフが足りず、繁忙期は家族で回しています。採用が難しいです。',
	'面接者: 予約はどのように管理していますか。',
	'経営者: 電話と手書きの予約表です。Web予約はありません。閑散期の集客も課題で、リピーター頼みです。',
	'面接者: 料金や資金面はいかがですか。',
	'経営者: 客単価を上げたいですが、値上げに不安があります。補助金や融資の情報もほしいです。',
	'面接者: 将来の目標は？',
	'経営者: 通年で客室を埋めることと、後継ぎ体制を整えることです。',
].join('\n');

const TRANSCRIPT_EN = [
	'Interviewer: Tell us about your business.',
	'Owner: We run an eight-room guesthouse. Winter and summer are fully booked, but the off-season is quiet.',
	'Interviewer: Main challenges?',
	'Owner: We are understaffed for cleaning; hiring is hard in our town.',
	'Interviewer: How do you take bookings?',
	'Owner: By phone, written into a paper diary. No online booking yet. We rely on repeat guests and word of mouth.',
	'Interviewer: Pricing and funds?',
	'Owner: We would like to raise rates but hesitate. We also want to know about subsidy programs.',
	'Interviewer: Goals?',
	'Owner: Fill rooms year-round and prepare a successor.',
].join('\n');

const TRANSCRIPT_NONE = [
	'面接者: こんにちは。',
	'経営者: ありがとうございます。',
].join('\n');

// A hostile transcript: HTML, fake headings, fake list conventions.
const TRANSCRIPT_HOSTILE = [
	'面接者: 課題は？',
	'経営者: 人手不足です。<script>alert(1)</script>',
	'経営者: # 偽の見出し',
	'経営者: - 偽の箇条書き',
	'経営者: <img src=x onerror="alert(1)">',
].join('\n');

async function loadAnalyzer() {
	return import('../server/analyze/index.ts');
}

async function loadParser() {
	return import('../app/utils/report-content.ts');
}

test('analyzer: JA accommodation report carries the decision-ready sections', async () => {
	const { generateReportContent } = await loadAnalyzer();
	const content = generateReportContent(
		TRANSCRIPT_JA,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);

	// Existing Markdown assertions (compatibility with the API journey).
	assert.match(content, /^# /m, 'markdown heading');
	assert.match(content, /ペンション木もれび/);
	assert.match(content, /自動下書き（ルールベース）/);
	assert.match(content, /人材/);
	assert.match(content, /繁忙/);
	assert.doesNotMatch(
		content,
		/客室は8室、冬と夏に予約が集中/,
		'report must not dump verbatim transcript excerpts',
	);

	// New decision-ready sections with reliable headings.
	assert.match(content, /## 改善フローの比較/);
	assert.match(content, /### 現在の流れ（例）/);
	assert.match(content, /### 改善後の流れ（例）/);
	assert.match(content, /## ボトルネック/);
	assert.match(content, /## 削減できる時間と前提/);
	assert.match(content, /前提:/);
	assert.match(content, /## 導入の負担/);
	assert.match(content, /## 概算費用（目安）/);
	assert.match(content, /0円〜3万円/);
	assert.match(content, /## 既製品と独自開発/);
	assert.match(
		content,
		/例示です。面談の記録で確認できた内容ではありません。（ルールベース）/,
	);
	assert.equal(
		(content.match(/分類: ルールベースの推定/g) || []).length >= 3,
		true,
		'time, workload and cost sections carry the estimate label',
	);
	assert.match(
		content,
		/数値はルールベースの推定値/,
		'footer labels the rule-based forecast',
	);
});

test('parser: structured view of the JA accommodation report', async () => {
	const [{ generateReportContent }, { parseReportContent }] =
		await Promise.all([loadAnalyzer(), loadParser()]);
	const content = generateReportContent(
		TRANSCRIPT_JA,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);
	const parsed = parseReportContent(content);
	assert.ok(parsed, 'parses into structured data');
	assert.equal(parsed.locale, 'ja');
	assert.equal(parsed.businessName, 'ペンション木もれび');
	assert.match(parsed.draftLabel ?? '', /自動下書き/);
	assert.equal(parsed.meta.municipality, 'ニセコ町');
	assert.equal(parsed.meta.generatedAt, GENERATED_AT);
	assert.ok(parsed.summary.length >= 1, 'summary bullets');

	// Side-by-side ordered diagrams: two ordered step lists.
	assert.ok(parsed.flow, 'flow pair parsed');
	assert.equal(parsed.flow.currentSteps.length, 4);
	assert.equal(parsed.flow.improvedSteps.length, 4);
	assert.ok(
		parsed.flow.improvedSteps.some((step) => step.includes('作業リスト')),
		'flow template feeds a concrete task list',
	);
	assert.match(parsed.flow.exampleLabel ?? '', /例示/);
	assert.match(parsed.flow.exampleLabel ?? '', /ルールベース/);

	// Bottlenecks stay grounded in matched interview topics.
	assert.ok(parsed.bottlenecks.length >= 2);
	assert.ok(
		parsed.bottlenecks.every((line) => !line.includes('客室は8室')),
		'bottlenecks never quote the transcript verbatim',
	);

	// Labeled estimate sections.
	assert.ok(parsed.timeSavings, 'time savings section');
	assert.ok(parsed.timeSavings.items.length >= 2);
	assert.ok(
		parsed.timeSavings.items.every((item) => !item.startsWith('分類:')),
	);
	assert.match(parsed.timeSavings.estimateLabel ?? '', /ルールベースの推定/);
	assert.ok(parsed.workload, 'workload section');
	assert.ok(parsed.workload.items.length >= 2);
	assert.match(parsed.workload.estimateLabel ?? '', /ルールベースの推定/);
	assert.ok(parsed.costs, 'costs section');
	assert.ok(parsed.costs.items.some((item) => item.includes('円')));
	assert.match(parsed.costs.estimateLabel ?? '', /ルールベースの推定/);
	assert.ok(parsed.buildVsBuy.length >= 2);

	// Topic-by-topic review and next steps stay intact.
	assert.ok(parsed.topics.length >= 6);
	const staffing = parsed.topics.find((topic) =>
		topic.title.includes('人材の確保と定着'),
	);
	assert.ok(staffing, 'staffing topic parsed');
	assert.ok(staffing.observation && staffing.action);
	assert.equal(parsed.nextSteps.length, 3);
	assert.match(parsed.footnote ?? '', /ルールベース/);
});

test('analyzer+parser: EN accommodation report with EN conventions', async () => {
	const [{ generateReportContent }, { parseReportContent }] =
		await Promise.all([loadAnalyzer(), loadParser()]);
	const content = generateReportContent(
		TRANSCRIPT_EN,
		EN_SNAPSHOT,
		GENERATED_AT,
	);

	assert.match(content, /^# /m);
	assert.match(content, /Komorebi Guesthouse/);
	assert.match(content, /Automated draft \(rule-based\)/);
	assert.match(content, /## Flow comparison/);
	assert.match(content, /### Current flow \(example\)/);
	assert.match(content, /### Improved flow \(example\)/);
	assert.match(content, /## Time savings and assumptions/);
	assert.match(content, /## Indicative costs/);
	assert.match(content, /30,000 JPY/);
	assert.match(
		content,
		/Examples only — not facts confirmed in the interview\. \(rule-based\)/,
	);
	assert.equal(
		(content.match(/Classification: rule-based estimate/g) || []).length
			>= 3,
		true,
	);
	assert.doesNotMatch(
		content,
		/eight-room guesthouse\. Winter and summer/,
		'no verbatim transcript excerpts',
	);

	const parsed = parseReportContent(content);
	assert.ok(parsed);
	assert.equal(parsed.locale, 'en');
	assert.equal(parsed.businessName, 'Komorebi Guesthouse');
	assert.match(parsed.draftLabel ?? '', /Automated draft/);
	assert.ok(parsed.flow);
	assert.equal(parsed.flow.currentSteps.length, 4);
	assert.equal(parsed.flow.improvedSteps.length, 4);
	assert.ok(parsed.flow.improvedSteps.some((s) => s.includes('task list')));
	assert.match(parsed.flow.exampleLabel ?? '', /Examples only/);
	assert.ok(parsed.timeSavings);
	assert.match(parsed.timeSavings.estimateLabel ?? '', /rule-based estimate/);
	assert.ok(parsed.costs);
	assert.ok(parsed.costs.items.some((item) => item.includes('JPY')));
	assert.match(parsed.workload.estimateLabel ?? '', /rule-based estimate/);
	assert.ok(parsed.buildVsBuy.length >= 2);
	assert.ok(parsed.topics.length >= 6);
	assert.equal(parsed.nextSteps.length, 3);
});

test('analyzer+parser: the shared flow template avoids inn-specific claims', async () => {
	const [{ generateReportContent }, { parseReportContent }] =
		await Promise.all([loadAnalyzer(), loadParser()]);
	const content = generateReportContent(
		TRANSCRIPT_JA,
		FOOD_SNAPSHOT,
		GENERATED_AT,
	);

	assert.match(content, /## 改善フローの比較/);
	assert.match(content, /分類: ルールベースの推定/);
	assert.match(content, /予約・受注/);

	const parsed = parseReportContent(content);
	assert.ok(parsed);
	assert.equal(parsed.locale, 'ja');
	assert.ok(parsed.flow);
	assert.equal(parsed.flow.currentSteps.length, 4);
	assert.equal(parsed.flow.improvedSteps.length, 4);
	assert.ok(parsed.timeSavings);
	assert.ok(parsed.costs);
	assert.ok(parsed.costs.items.some((item) => item.includes('円')));
	assert.ok(parsed.buildVsBuy.length >= 2);
	assert.ok(parsed.topics.length >= 6);
});

test('analyzer: no matched topics yields honest empty-state sections', async () => {
	const [{ generateReportContent }, { parseReportContent }] =
		await Promise.all([loadAnalyzer(), loadParser()]);
	const content = generateReportContent(
		TRANSCRIPT_NONE,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);
	assert.match(content, /該当する論点は検出されませんでした/);
	assert.match(content, /ボトルネックを検出できませんでした/);

	const parsed = parseReportContent(content);
	assert.ok(parsed);
	assert.equal(parsed.topics.length, 0);
	assert.equal(parsed.bottlenecks.length, 1);
	assert.ok(parsed.flow, 'the flow template is still offered as an example');
	assert.ok(parsed.timeSavings);
});

test('analyzer: deterministic output and inert hostile transcript', async () => {
	const { generateReportContent } = await loadAnalyzer();
	const a = generateReportContent(
		TRANSCRIPT_JA,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);
	const b = generateReportContent(
		TRANSCRIPT_JA,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);
	assert.equal(a, b, 'same input, same output');

	const hostile = generateReportContent(
		TRANSCRIPT_HOSTILE,
		ACCOMMODATION_SNAPSHOT,
		GENERATED_AT,
	);
	assert.doesNotMatch(hostile, /<script/);
	assert.doesNotMatch(hostile, /onerror/);
	assert.doesNotMatch(hostile, /偽の見出し/, 'fake headings are not echoed');
	assert.doesNotMatch(hostile, /偽の箇条書き/, 'fake lists are not echoed');
	assert.match(hostile, /^# 経営相談レポート（デモ）: /m, 'title stays ours');
});

test('parser: legacy report without the new sections parses partially', async () => {
	const { parseReportContent } = await loadParser();
	const legacy = [
		'# 経営相談レポート（デモ）: 湯の花旅館',
		'',
		'> 自動下書き（ルールベース） — サンプル面談（フィクション）の記録をもとに生成されています。',
		'',
		'- 業種: 宿泊業（accommodation）',
		'- 地域: ニセコ町',
		'- 生成日時: 2026-11-25T09:00:00.000Z',
		'',
		'## まとめ',
		'- 面談の記録から、次の論点が確認できました: 人材の確保と定着。',
		'',
		'## 論点ごとの整理',
		'',
		'### 人材の確保と定着',
		'- 観察: 面談の中で人手不足や採用・労務に関する話題が確認されました。',
		'- 推奨アクション: 市と商工団体の雇用支援制度に相談しましょう。',
		'',
		'## 次のステップ',
		'1. 市の商工担当課に相談する。',
		'2. レポート画面から相談を申し込む。',
		'3. 今月できる行動を決める。',
		'',
		'---',
		'※ 本レポートは「自動下書き（ルールベース）」のデモ出力です。',
	].join('\n');
	const parsed = parseReportContent(legacy);
	assert.ok(parsed, 'legacy reports still parse');
	assert.equal(parsed.businessName, '湯の花旅館');
	assert.equal(parsed.meta.generatedAt, '2026-11-25T09:00:00.000Z');
	assert.equal(parsed.topics.length, 1);
	assert.equal(parsed.nextSteps.length, 3);
	assert.equal(parsed.flow, null, 'no flow section in legacy content');
	assert.equal(parsed.timeSavings, null);
	assert.equal(parsed.workload, null);
	assert.equal(parsed.costs, null);
	assert.deepEqual(parsed.buildVsBuy, []);
});

test('parser: arbitrary and hostile text never yields executable HTML', async () => {
	const { parseReportContent, renderMarkdownBlocks } = await loadParser();
	assert.equal(parseReportContent(''), null);
	assert.equal(parseReportContent('   \n  '), null);
	assert.equal(parseReportContent('ただの文章です。'), null);

	const sneaky = [
		'# 経営相談レポート（デモ）: テスト',
		'',
		'<img src=x onerror="alert(1)">',
		'<script>alert(1)</script>',
		'[click](javascript:alert(1))',
	].join('\n');
	const parsed = parseReportContent(sneaky);
	assert.ok(parsed, 'still structured, HTML arrives as inert text');
	for (const block of renderMarkdownBlocks(sneaky)) {
		assert.ok(
			[
				'heading',
				'paragraph',
				'bulletList',
				'orderedList',
				'quote',
				'divider',
			].includes(block.kind),
			`block kind is whitelisted, got ${block.kind}`,
		);
	}
});

test('parser: markdown block renderer covers the report shapes text-only', async () => {
	const { renderMarkdownBlocks } = await loadParser();
	const blocks = renderMarkdownBlocks(
		[
			'# 見出し1',
			'',
			'> 引用文',
			'',
			'## 見出し2',
			'- 箇条書き1',
			'- 箇条書き2',
			'',
			'1. 手順1',
			'2. 手順2',
			'',
			'---',
			'',
			'段落 **強調** テキスト',
		].join('\n'),
	);
	assert.deepEqual(
		blocks.map((block) => block.kind),
		[
			'heading',
			'quote',
			'heading',
			'bulletList',
			'orderedList',
			'divider',
			'paragraph',
		],
	);
	assert.equal(blocks[0].text, '見出し1');
	assert.equal(blocks[2].level, 2);
	assert.deepEqual(blocks[3].items, ['箇条書き1', '箇条書き2']);
	assert.deepEqual(blocks[4].items, ['手順1', '手順2']);
	const paragraph = blocks[blocks.length - 1];
	assert.equal(paragraph.text, '段落 強調 テキスト');
});

test('locales: report page dictionaries keep ja/en key parity', async () => {
	const [ja, en] = await Promise.all([
		import('../app/locales/report-ja.ts'),
		import('../app/locales/report-en.ts'),
	]);
	const shape = (value, path) => {
		if (value === null || typeof value !== 'object') {
			return path;
		}
		return Object.keys(value)
			.sort()
			.map((key) => shape(value[key], `${path}.${key}`))
			.join('|');
	};
	assert.equal(
		shape(ja.reportJa, ''),
		shape(en.reportEn, ''),
		'ja and en dictionaries expose identical keys',
	);
});

test('format: report datetime renders deterministically in UTC', async () => {
	const { formatReportDateTime } = await loadParser();
	const ja = formatReportDateTime('2026-11-25T09:00:00.000Z', 'ja');
	const en = formatReportDateTime('2026-11-25T09:00:00.000Z', 'en');
	assert.match(ja, /2026年11月25日/);
	assert.match(ja, /UTC/);
	assert.match(en, /2026/);
	assert.match(en, /Nov/);
	assert.match(en, /UTC/);
});
