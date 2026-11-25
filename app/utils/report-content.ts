// Safe report content tooling for the report page (app-owned):
// - parseReportContent: turns the report Markdown (analyzer conventions,
//   see shared/types/report-content.ts) into structured data for the
//   decision-ready view. Bilingual heading matching, fully tolerant: any
//   missing section stays null/empty, unknown content degrades gracefully.
// - renderMarkdownBlocks: a text-only Markdown block scanner for the
//   fallback "original text" view. It never produces HTML — the page renders
//   these blocks with Vue text interpolation only (no v-html anywhere).
// - formatReportDateTime: deterministic UTC timestamp formatting.
// Pure functions, no Nuxt/Vue imports, so unit tests can load this file
// directly (type-only #shared imports are erased at runtime).
import type {
	MarkdownBlock,
	ReportContent,
	ReportEstimateSection,
	ReportTopicContent,
} from '#shared/types/report-content';
import type { Locale } from '#shared/types/domain';

export type {
	MarkdownBlock,
	ReportContent,
	ReportEstimateSection,
	ReportTopicContent,
};

// --- heading conventions (stable strings emitted by the analyzer) -----------

const HEADINGS = {
	summary: { ja: 'まとめ', en: 'Summary' },
	flow: { ja: '改善フローの比較', en: 'Flow comparison' },
	currentFlow: { ja: '現在の流れ', en: 'Current flow' },
	improvedFlow: { ja: '改善後の流れ', en: 'Improved flow' },
	bottlenecks: { ja: 'ボトルネック', en: 'Bottlenecks' },
	timeSavings: {
		ja: '削減できる時間と前提',
		en: 'Time savings and assumptions',
	},
	workload: { ja: '導入の負担', en: 'Implementation workload' },
	costs: { ja: '概算費用', en: 'Indicative costs' },
	buildVsBuy: { ja: '既製品と独自開発', en: 'Off-the-shelf or custom' },
	topics: { ja: '論点ごとの整理', en: 'Topic-by-topic review' },
	nextSteps: { ja: '次のステップ', en: 'Next steps' },
} as const;

const TITLE_PREFIXES = {
	ja: '経営相談レポート（デモ）: ',
	en: 'Business consultation report (demo): ',
};

const META_PATTERNS = {
	municipality: /^(?:地域|Municipality):\s*(.*)$/,
	generatedAt: /^(?:生成日時|Generated at):\s*(.*)$/,
};

const ESTIMATE_LABEL_PATTERN = /^(?:分類|Classification):\s*(.*)$/;
const PRIORITY_PATTERN = /^(?:優先度|Priority):\s*(\d+)/;
const OBSERVATION_PATTERN = /^(?:観察|Observation):\s*(.*)$/;
const ACTION_PATTERN = /^(?:推奨アクション|Recommended action):\s*(.*)$/;

const ORDERED_ITEM_PATTERN = /^\d+[.)]\s+(.*)$/;
const BULLET_ITEM_PATTERN = /^(?:[-*•])\s+(.*)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const HEADING_PATTERN = /^(#{1,3})\s+(.*)$/;
const DIVIDER_PATTERN = /^(?:-{3,}|\*{3,})$/;

// Safety valves for pathological input (content is server-generated, but the
// parser must never hang or balloon on arbitrary text).
const MAX_ITEMS = 60;
const MAX_TOPICS = 30;

// --- parser -----------------------------------------------------------------

export function parseReportContent(raw: string): ReportContent | null {
	const lines = String(raw ?? '').split(/\r?\n/);
	const result: ReportContent = {
		locale: null,
		title: '',
		businessName: null,
		draftLabel: null,
		meta: { municipality: null, generatedAt: null },
		summary: [],
		flow: null,
		bottlenecks: [],
		timeSavings: null,
		workload: null,
		costs: null,
		buildVsBuy: [],
		topics: [],
		nextSteps: [],
		footnote: null,
	};

	let jaMatched = false;
	let enMatched = false;
	let seenHeading2 = false;
	let section: string | null = null; // key into HEADINGS when recognized
	let subsection: 'currentFlow' | 'improvedFlow' | null = null;
	let topic: ReportTopicContent | null = null;
	let quoteCount = 0;
	let afterDivider = false;

	const flushTopic = () => {
		if (topic) {
			if (result.topics.length < MAX_TOPICS) {
				result.topics.push(topic);
			}
			topic = null;
		}
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();

		const heading = HEADING_PATTERN.exec(trimmed);
		if (heading) {
			flushTopic();
			const level = heading[1].length as 1 | 2 | 3;
			const text = stripInline(heading[2]);
			if (level === 1 && !result.title) {
				result.title = text;
				for (const locale of ['ja', 'en'] as const) {
					if (text.startsWith(TITLE_PREFIXES[locale])) {
						result.businessName = text
							.slice(TITLE_PREFIXES[locale].length)
							.trim();
						result.locale = locale;
					}
				}
				if (!result.businessName) {
					const colon = text.search(/[:：]\s*/);
					if (colon >= 0) {
						result.businessName =
							text.slice(colon + 1).trim() || null;
					}
				}
				continue;
			}
			if (level > 1) {
				if (level === 2) {
					seenHeading2 = true;
					afterDivider = false;
					subsection = null;
					topic = null;
					section = matchSection(text);
					if (section === 'summary') {
						jaMatched ||= text.startsWith(HEADINGS.summary.ja);
						enMatched ||= text.startsWith(HEADINGS.summary.en);
					}
					continue;
				}
				// H3: flow subsections or topic entries.
				if (section === 'flow') {
					if (startsWithAny(text, HEADINGS.currentFlow)) {
						subsection = 'currentFlow';
						jaMatched ||= text.startsWith(HEADINGS.currentFlow.ja);
						enMatched ||= text.startsWith(HEADINGS.currentFlow.en);
						continue;
					}
					if (startsWithAny(text, HEADINGS.improvedFlow)) {
						subsection = 'improvedFlow';
						continue;
					}
				}
				if (section === 'topics') {
					subsection = null;
					flushTopic();
					if (result.topics.length < MAX_TOPICS) {
						topic = {
							title: text,
							rank: null,
							observation: null,
							action: null,
						};
					}
					continue;
				}
				subsection = null;
				continue;
			}
			continue;
		}

		if (DIVIDER_PATTERN.test(trimmed) && trimmed.length >= 3) {
			flushTopic();
			section = null;
			subsection = null;
			afterDivider = true;
			continue;
		}

		if (trimmed.length === 0) {
			continue;
		}

		if (afterDivider) {
			const footnoteText = stripInline(trimmed);
			result.footnote =
				result.footnote ?
					`${result.footnote}\n${footnoteText}`
				:	footnoteText;
			continue;
		}

		const quote = QUOTE_PATTERN.exec(trimmed);
		if (quote) {
			const text = stripInline(quote[1]);
			if (!seenHeading2 && quoteCount === 0) {
				result.draftLabel = text;
			} else if (section === 'flow' && !result.flow?.exampleLabel) {
				ensureFlow(result).exampleLabel = text;
			}
			quoteCount += 1;
			continue;
		}

		const ordered = ORDERED_ITEM_PATTERN.exec(trimmed);
		if (ordered) {
			const text = stripInline(ordered[1]);
			if (section === 'flow' && subsection) {
				const flow = ensureFlow(result);
				const target =
					subsection === 'currentFlow' ?
						flow.currentSteps
					:	flow.improvedSteps;
				if (target.length < MAX_ITEMS) {
					target.push(text);
				}
			} else if (section === 'nextSteps') {
				if (result.nextSteps.length < MAX_ITEMS) {
					result.nextSteps.push(text);
				}
			}
			continue;
		}

		const bullet = BULLET_ITEM_PATTERN.exec(trimmed);
		if (bullet) {
			const text = stripInline(bullet[1]);
			if (!seenHeading2) {
				const meta = matchMeta(text);
				if (meta) {
					result.meta[meta.key] = meta.value;
					continue;
				}
			}
			switch (section) {
				case 'summary': {
					if (result.summary.length < MAX_ITEMS) {
						result.summary.push(text);
					}
					break;
				}
				case 'bottlenecks': {
					if (result.bottlenecks.length < MAX_ITEMS) {
						result.bottlenecks.push(text);
					}
					break;
				}
				case 'timeSavings':
				case 'workload':
				case 'costs': {
					const target = ensureEstimate(result, section);
					const label = ESTIMATE_LABEL_PATTERN.exec(text);
					if (label) {
						target.estimateLabel = label[1].trim() || null;
					} else if (target.items.length < MAX_ITEMS) {
						target.items.push(text);
					}
					break;
				}
				case 'buildVsBuy': {
					if (result.buildVsBuy.length < MAX_ITEMS) {
						result.buildVsBuy.push(text);
					}
					break;
				}
				case 'topics': {
					if (!topic) {
						break;
					}
					const priority = PRIORITY_PATTERN.exec(text);
					if (priority) {
						topic.rank = Number.parseInt(priority[1], 10);
					} else {
						const observation = OBSERVATION_PATTERN.exec(text);
						const action = ACTION_PATTERN.exec(text);
						if (observation) {
							topic.observation = observation[1].trim() || null;
						} else if (action) {
							topic.action = action[1].trim() || null;
						}
					}
					break;
				}
				default:
					break;
			}
			continue;
		}

		// Any other non-empty line before/inside sections is unstructured;
		// the page renders the full document text separately.
	}

	flushTopic();
	if (jaMatched && !enMatched) {
		result.locale = 'ja';
	} else if (enMatched && !jaMatched) {
		result.locale = 'en';
	}
	if (!result.title) {
		return null;
	}
	return result;
}

function startsWithAny(
	text: string,
	pair: { ja: string; en: string },
): boolean {
	return text.startsWith(pair.ja) || text.startsWith(pair.en);
}

function matchSection(heading: string): string | null {
	for (const [key, pair] of Object.entries(HEADINGS)) {
		if (key === 'currentFlow' || key === 'improvedFlow') {
			continue; // H3 subsections are matched inside the flow section.
		}
		if (startsWithAny(heading, pair)) {
			return key;
		}
	}
	return null;
}

function matchMeta(bullet: string): {
	key: 'municipality' | 'generatedAt';
	value: string | null;
} | null {
	for (const key of ['municipality', 'generatedAt'] as const) {
		const match = META_PATTERNS[key].exec(bullet);
		if (match) {
			return { key, value: match[1]?.trim() || null };
		}
	}
	return null;
}

function ensureFlow(result: ReportContent) {
	if (!result.flow) {
		result.flow = {
			currentSteps: [],
			improvedSteps: [],
			exampleLabel: null,
		};
	}
	return result.flow;
}

function ensureEstimate(
	result: ReportContent,
	key: 'timeSavings' | 'workload' | 'costs',
): ReportEstimateSection {
	if (!result[key]) {
		result[key] = { items: [], estimateLabel: null };
	}
	return result[key];
}

// --- text-only markdown block scanner ----------------------------------------

export function renderMarkdownBlocks(content: string): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	const lines = String(content ?? '').split(/\r?\n/);
	let paragraph: string[] = [];
	let bullets: string[] | null = null;
	let ordered: string[] | null = null;
	let quote: string[] | null = null;

	const flush = () => {
		if (paragraph.length > 0) {
			blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
			paragraph = [];
		}
		if (bullets) {
			blocks.push({
				kind: 'bulletList',
				items: bullets.slice(0, MAX_ITEMS),
			});
			bullets = null;
		}
		if (ordered) {
			blocks.push({
				kind: 'orderedList',
				items: ordered.slice(0, MAX_ITEMS),
			});
			ordered = null;
		}
		if (quote) {
			blocks.push({ kind: 'quote', text: quote.join('\n') });
			quote = null;
		}
	};

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();

		const heading = HEADING_PATTERN.exec(trimmed);
		if (heading) {
			flush();
			blocks.push({
				kind: 'heading',
				level: heading[1].length as 1 | 2 | 3,
				text: stripInline(heading[2]),
			});
			continue;
		}

		if (DIVIDER_PATTERN.test(trimmed)) {
			flush();
			blocks.push({ kind: 'divider' });
			continue;
		}

		if (trimmed.length === 0) {
			flush();
			continue;
		}

		const quoteMatch = QUOTE_PATTERN.exec(trimmed);
		if (quoteMatch) {
			if (paragraph.length > 0 || bullets || ordered) {
				flush();
			}
			quote = quote ?? [];
			quote.push(stripInline(quoteMatch[1]));
			continue;
		}

		const bulletMatch = BULLET_ITEM_PATTERN.exec(trimmed);
		if (bulletMatch) {
			if (paragraph.length > 0 || ordered || quote) {
				flush();
			}
			bullets = bullets ?? [];
			if (bullets.length < MAX_ITEMS) {
				bullets.push(stripInline(bulletMatch[1]));
			}
			continue;
		}

		const orderedMatch = ORDERED_ITEM_PATTERN.exec(trimmed);
		if (orderedMatch) {
			if (paragraph.length > 0 || bullets || quote) {
				flush();
			}
			ordered = ordered ?? [];
			if (ordered.length < MAX_ITEMS) {
				ordered.push(stripInline(orderedMatch[1]));
			}
			continue;
		}

		if (quote) {
			flush();
		}
		paragraph.push(stripInline(trimmed));
	}
	flush();
	return blocks;
}

// Strips lightweight inline emphasis markers; keeps everything else as plain
// text. Links are never turned into anchors — the URL stays as text.
function stripInline(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/(^|\W)\*([^*\s][^*]*)\*/g, '$1$2')
		.replace(/`([^`]*)`/g, '$1');
}

// --- formatting --------------------------------------------------------------

export function formatReportDateTime(iso: string, locale: Locale): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return iso;
	}
	const formatted = date.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US', {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
	return `${formatted} (UTC)`;
}
