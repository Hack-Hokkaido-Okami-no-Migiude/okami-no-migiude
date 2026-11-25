// Structured report content (additive, lead-approved approach): the report
// `content` stays Markdown in the DB, the API and the download (contract §5),
// and the page derives a decision-ready structured view from it via reliable
// headings + explicit conventions below. This module is type-only.
//
// Markdown conventions the analyzer emits and the app parses:
// - H1: `# 経営相談レポート（デモ）: <businessName>` /
//       `# Business consultation report (demo): <businessName>`
//   → `title`, `businessName` (text after the first ": ").
// - First blockquote before any H2 → `draftLabel` (the §11 rule-based label).
// - Metadata bullets: `- 地域: ` / `- Municipality: ` and
//   `- 生成日時: ` / `- Generated at: `.
// - `## 改善フローの比較` / `## Flow comparison` with a blockquote example
//   label and two H3 ordered lists: `### 現在の流れ（例）` /
//   `### Current flow (example)` and `### 改善後の流れ（例）` /
//   `### Improved flow (example)` → `flow` (two side-by-side ordered diagrams).
// - `## ボトルネック` / `## Bottlenecks` bullets → `bottlenecks`
//   (grounded in matched interview topics; honest empty state otherwise).
// - `## 削減できる時間と前提` / `## Time savings and assumptions`,
//   `## 導入の負担` / `## Implementation workload`,
//   `## 概算費用（目安）` / `## Indicative costs` bullets → estimate sections;
//   each ends with `- 分類: ルールベースの推定…` /
//   `- Classification: rule-based estimate…`, parsed into `estimateLabel`.
// - `## 既製品と独自開発` / `## Off-the-shelf or custom` bullets → buildVsBuy.
// - `## 論点ごとの整理` / `## Topic-by-topic review` H3 topics with
//   `- 優先度: N…` / `- Priority: N…` (rank, 1 = highest),
//   `- 観察: ` / `- Observation: ` and `- 推奨アクション: ` /
//   `- Recommended action: ` bullets → `topics`.
// - `## 次のステップ` / `## Next steps` ordered list → `nextSteps`.
// - Text after the `---` divider → `footnote`.
// Any missing section simply stays null/empty; unrecognized content renders
// as plain text only (never HTML).
import type { Locale } from './domain';

export type ReportMetaContent = {
	municipality: string | null;
	generatedAt: string | null;
};

/** Two ordered step lists rendered as side-by-side diagrams on the page. */
export type ReportFlowPair = {
	currentSteps: string[];
	improvedSteps: string[];
	/** Rule-based example label emitted under the comparison heading. */
	exampleLabel: string | null;
};

/** A bullet list section that carries an explicit rule-based estimate label. */
export type ReportEstimateSection = {
	items: string[];
	estimateLabel: string | null;
};

export type ReportTopicContent = {
	title: string;
	/** Rank among this report's recommendations (1 = highest); null when absent. */
	rank: number | null;
	observation: string | null;
	action: string | null;
};

/** Text-only Markdown block for the fallback document view (never HTML). */
export type MarkdownBlock =
	| { kind: 'heading'; level: 1 | 2 | 3; text: string }
	| { kind: 'paragraph'; text: string }
	| { kind: 'bulletList'; items: string[] }
	| { kind: 'orderedList'; items: string[] }
	| { kind: 'quote'; text: string }
	| { kind: 'divider' };

export type ReportContent = {
	/** Detected from which language's headings matched; null if neither. */
	locale: Locale | null;
	title: string;
	businessName: string | null;
	draftLabel: string | null;
	meta: ReportMetaContent;
	summary: string[];
	flow: ReportFlowPair | null;
	bottlenecks: string[];
	timeSavings: ReportEstimateSection | null;
	workload: ReportEstimateSection | null;
	costs: ReportEstimateSection | null;
	buildVsBuy: string[];
	topics: ReportTopicContent[];
	nextSteps: string[];
	footnote: string | null;
};
