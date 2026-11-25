// Post-call deep-research composition for the assessment job. The transcript
// never leaves the server: it is reduced to matched topic titles with the
// deterministic keyword rules from server/analyze/rules.ts, and those titles
// fill the focus prompt for Linkup's heaviest reasoning depth. The deep pass
// runs with outputType 'sourcedAnswer' (chosen in providers.ts), so its
// result is a full sourced dossier — workflows, named tools, implementation
// effort — rather than the in-call pass's structured case list. A leaf
// module (both imports are type-only and erased before Node resolves
// anything), so it stays unit-testable under plain Node — see
// tests/voice-deep-research.test.mjs.
import type { Locale } from '#shared/types/domain';
import type { Topic } from '../analyze/rules';

/** Linkup reasoning depth for the post-call pass: the heaviest tier. */
export const DEEP_RESEARCH_REASONING_DEPTH = 'XL' as const;

/**
 * XL latency ceiling (10–20 minutes per Linkup's docs) plus margin, so a
 * healthy deep pass is never cut off by the assessment research deadline.
 */
export const DEEP_RESEARCH_TIMEOUT_MS = 25 * 60_000;

/** At most four focus topics keep the research query readable. */
const MAX_FOCUS_TOPICS = 4;

const FOCUS_PROMPT_TEMPLATE = `Research how the work at the business described below is handled at comparable businesses, and produce a thorough, source-backed briefing the owner can act on.

- **Location:** [LOCATION]
- **Industry:** small local business (accommodation, food service, retail, tourism, and similar)
[FOCUS]For every topic the briefing covers, include the following.

- How the task is handled today at comparable businesses and where the time goes.
- Concrete ways to automate or streamline it, described as step-by-step workflows: who runs each step, which system does what, and how information moves between the tools.
- Named tools and services that fit a small business: what they do, what they cost where documented, what they integrate with (for example booking, POS, accounting, spreadsheets, messaging apps), and how they are set up.
- Implementation effort and technical detail: setup steps, data the business must prepare, staff skills required, ongoing maintenance, and what a very small team can realistically run.
- Documented results at comparable businesses — time savings, cost reductions, revenue improvements — with the source for each claim.
- Risks, pitfalls and common reasons implementations fail.

Search in English and the local language. Clearly distinguish verified results from estimates and recommendations. Avoid unsupported claims.`;

/**
 * The topics whose keyword rules match the transcript, titled in the report
 * language. Matches run against both language tables so a Japanese owner
 * slipping an English term still counts.
 */
export function matchedTopicTitles(
	transcript: string,
	topics: Topic[],
	locale: Locale,
): string[] {
	const haystack = transcript.toLowerCase();
	const titles: string[] = [];
	for (const topic of topics) {
		const keywords = [...topic.keywords.ja, ...topic.keywords.en];
		if (
			keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
		) {
			titles.push(locale === 'ja' ? topic.ja.title : topic.en.title);
			if (titles.length >= MAX_FOCUS_TOPICS) {
				break;
			}
		}
	}
	return titles;
}

/**
 * Builds the deep-pass research query: the dossier prompt with the business
 * intake and, when the transcript named any focus topics, an extra bullet
 * steering the research at them. No verbatim transcript text is included —
 * only the matched topic titles.
 */
export function deepResearchPrompt(
	business: { location: string },
	transcript: string,
	topics: Topic[],
	locale: Locale,
): string {
	const titles = matchedTopicTitles(transcript, topics, locale);
	const focus = titles.length
		? `- **Focus topics from the interview:** ${
				titles.join(locale === 'ja' ? '、' : ', ')
			}\n\nWeight the search toward these topics: the interview showed the owner loses the most time there.\n`
		: '';
	return FOCUS_PROMPT_TEMPLATE.replace(
		/\[(LOCATION|FOCUS)\]/g,
		(_, key: string) => (key === 'LOCATION' ? business.location : focus),
	);
}
