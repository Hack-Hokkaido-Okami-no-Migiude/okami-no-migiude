// Demo report generator (§11): a pure, deterministic rule engine over the
// transcript and the owner profile snapshot. Same input, same output, no
// network. Rich and specific for accommodation (the demo inn persona), with a
// solid generic engine for every other business type.
import { TOPICS, opsFor } from './rules';
import type { OpsRecommendation, Snapshot } from './rules';

export function generateReportContent(
	transcript: string,
	snapshot: Snapshot,
	generatedAt: string,
): string {
	const haystack = transcript.toLowerCase();
	const matched = TOPICS.filter((topic) =>
		[...topic.keywords.ja, ...topic.keywords.en].some((keyword) =>
			haystack.includes(keyword.toLowerCase()),
		),
	);
	return snapshot.locale === 'ja' ?
			renderJa(matched, snapshot, generatedAt)
		:	renderEn(matched, snapshot, generatedAt);
}

type MatchedTopic = (typeof TOPICS)[number];

/** The decision-ready block shared by both locales (heading text varies). */
function decisionSections(matched: MatchedTopic[], snapshot: Snapshot): string {
	const ops = opsFor();
	const digitalMatched = matched.some((topic) => topic.id === 'digital');
	if (snapshot.locale === 'ja') {
		return decisionJa(matched, ops, digitalMatched);
	}
	return decisionEn(matched, ops, digitalMatched);
}

function orderedList(steps: string[]): string {
	return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

function estimateSection(heading: string, items: string[]): string {
	return `${heading}\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function decisionJa(
	matched: MatchedTopic[],
	ops: OpsRecommendation,
	digitalMatched: boolean,
): string {
	const bottleneckLines = matched.map(
		(topic) => `- ${topic.ja.title} — ${topic.ja.observation}`,
	);
	if (digitalMatched && ops.bottleneckExtra) {
		bottleneckLines.push(`- ${ops.bottleneckExtra.ja}`);
	}
	if (bottleneckLines.length === 0) {
		bottleneckLines.push(
			'- 面談の記録からは具体的なボトルネックを検出できませんでした。',
		);
	}
	return [
		'## 改善フローの比較',
		`> ${ops.flowExampleLabel.ja}`,
		'',
		'### 現在の流れ（例）',
		orderedList(ops.currentSteps.ja),
		'',
		'### 改善後の流れ（例）',
		orderedList(ops.improvedSteps.ja),
		'',
		'## ボトルネック',
		bottleneckLines.join('\n'),
		'',
		estimateSection('## 削減できる時間と前提', ops.timeSavings.ja),
		'',
		estimateSection('## 導入の負担', ops.workload.ja),
		'',
		estimateSection('## 概算費用（目安）', ops.costs.ja),
		'',
		estimateSection('## 既製品と独自開発', ops.buildVsBuy.ja),
	].join('\n');
}

function decisionEn(
	matched: MatchedTopic[],
	ops: OpsRecommendation,
	digitalMatched: boolean,
): string {
	const bottleneckLines = matched.map(
		(topic) => `- ${topic.en.title} — ${topic.en.observation}`,
	);
	if (digitalMatched && ops.bottleneckExtra) {
		bottleneckLines.push(`- ${ops.bottleneckExtra.en}`);
	}
	if (bottleneckLines.length === 0) {
		bottleneckLines.push(
			'- No specific bottleneck could be detected from the interview.',
		);
	}
	return [
		'## Flow comparison',
		`> ${ops.flowExampleLabel.en}`,
		'',
		'### Current flow (example)',
		orderedList(ops.currentSteps.en),
		'',
		'### Improved flow (example)',
		orderedList(ops.improvedSteps.en),
		'',
		'## Bottlenecks',
		bottleneckLines.join('\n'),
		'',
		estimateSection('## Time savings and assumptions', ops.timeSavings.en),
		'',
		estimateSection('## Implementation workload', ops.workload.en),
		'',
		estimateSection('## Indicative costs', ops.costs.en),
		'',
		estimateSection('## Off-the-shelf or custom', ops.buildVsBuy.en),
	].join('\n');
}

function renderJa(
	matched: MatchedTopic[],
	snapshot: Snapshot,
	generatedAt: string,
): string {
	const topicLines =
		matched.length > 0 ?
			`- 面談の記録から、次の論点が確認できました: ${matched.map((topic) => topic.ja.title).join('、')}。`
		:	'- 今回の面談記録からは具体的な論点を自動検出できませんでした。まずは下記の「次のステップ」から着手してください。';
	const sections = matched
		.map(
			(topic) => `### ${topic.ja.title}
- 観察: ${topic.ja.observation}
- 推奨アクション: ${topic.ja.action}`,
		)
		.join('\n\n');
	return `# 経営相談レポート（デモ）: ${snapshot.businessName}

> 自動下書き（ルールベース） — サンプル面談（フィクション）の記録をもとに生成されています。

- 地域: ${snapshot.municipality}
- 生成日時: ${generatedAt}

## まとめ
${topicLines}
${decisionSections(matched, snapshot)}

## 論点ごとの整理

${sections || '（該当する論点は検出されませんでした）'}

## 次のステップ
1. 市の商工・観光担当課や商工会議所に、このレポートの論点を持って相談する。
2. レポート画面から「相談を申し込む」でフォローを希望する（担当スタッフに状況が共有されます）。
3. 論点の中から優先度の高いものを一つ選び、今月中に実行できる行動を決める。

---
※ 本レポートは「自動下書き（ルールベース）」のデモ出力です。断定的な経営助言ではなく、相談のたたき台としてご利用ください。
※ 削減時間・費用などの数値はルールベースの推定値です。面談で確認した事実ではありません。
`;
}

function renderEn(
	matched: MatchedTopic[],
	snapshot: Snapshot,
	generatedAt: string,
): string {
	const topicLines =
		matched.length > 0 ?
			`- The interview records show the following topics: ${matched.map((topic) => topic.en.title).join(', ')}.`
		:	'- No specific topics could be auto-detected from this interview. Start with the next steps below.';
	const sections = matched
		.map(
			(topic) => `### ${topic.en.title}
- Observation: ${topic.en.observation}
- Recommended action: ${topic.en.action}`,
		)
		.join('\n\n');
	return `# Business consultation report (demo): ${snapshot.businessName}

> Automated draft (rule-based) — generated from a sample interview (fictional).

- Municipality: ${snapshot.municipality}
- Generated at: ${generatedAt}

## Summary
${topicLines}
${decisionSections(matched, snapshot)}

## Topic-by-topic review

${sections || '(No matching topics were detected.)'}

## Next steps
1. Take these topics to the municipal commerce/tourism desk or the chamber of commerce.
2. Request a follow-up consultation from the report page (shared with staff).
3. Pick the highest-priority topic and decide one action you can take this month.

---
※ This output is an "Automated draft (rule-based)" demo. Treat it as a base for consultation, not definitive business advice.
Note: time and cost figures above are rule-based estimates, not facts confirmed in the interview.
`;
}
