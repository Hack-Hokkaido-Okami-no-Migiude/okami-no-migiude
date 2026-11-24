// Pure purge rules for Shima rows, called by the store on every session
// commit: effort rows whose cited sources moved, packages whose opportunity
// vanished or whose draft still carries a stale verbatim source quote,
// previews of purged packages, quests of purged packages, and assignments of
// purged quests. A section that ends up completely empty resets to a fresh
// one; a partial purge keeps the section revision (purging is not an owner
// revision bump). No I/O here — the repository owns every write.
import {
	type ShimaSection,
	type ShimaState,
	emptyShimaSection,
} from './storage';
import { buildSourceIndex, evidenceRefIsValid } from '../store/sources';
import type { Session } from '../../shared/p0/types';
import type { TaskDraft } from '../../shared/shima/schemas';
import { stripInvalidCitations } from '../store/cascade';

/**
 * The next Shima state after a session commit: rows whose citations no longer
 * validate against the committed session are gone. Returns the input state
 * when nothing was purged, and undefined when there is no state at all.
 */
export function purgeShimaState(
	current: ShimaState | undefined,
	sessionKey: string,
	session: Session,
): ShimaState | undefined {
	if (!current) {
		return undefined;
	}
	const sources = buildSourceIndex(session);
	const { staleQuotes } = stripInvalidCitations(session);
	const opportunityIds = new Set(session.opportunities.map((o) => o.id));

	const section = current.sessions[sessionKey];
	let purged = false;
	let filteredSection: ShimaSection | null = null;
	if (section) {
		const effort = keepEntries(section.effort, (row) =>
			quantityEvidenceSurvives(row.weeklyOccurrences, sources)
			&& quantityEvidenceSurvives(row.minutesPerOccurrence, sources),
		);
		const packages = keepEntries(section.packages, (row) =>
			opportunityIds.has(row.package.opportunityId)
			&& !containsStaleQuote(row.package.draft, staleQuotes),
		);
		const previews = keepEntries(section.previews, (row) =>
			row.packageId in packages,
		);
		purged =
			Object.keys(effort).length !== Object.keys(section.effort).length
			|| Object.keys(packages).length !== Object.keys(section.packages).length
			|| Object.keys(previews).length !== Object.keys(section.previews).length;
		filteredSection = { ...section, effort, packages, previews };
	}

	const survivingQuests: ShimaState['quests'] = {};
	for (const [questId, quest] of Object.entries(current.quests)) {
		if (quest.source.clientId !== session.clientId
			|| quest.source.sessionId !== session.id) {
			survivingQuests[questId] = quest;
			continue;
		}
		if (filteredSection?.packages[quest.packageId]) {
			survivingQuests[questId] = quest;
			continue;
		}
		purged = true;
	}
	const survivingAssignments: ShimaState['assignments'] = {};
	for (const [assignmentId, assignment] of Object.entries(current.assignments)) {
		if (survivingQuests[assignment.questId]) {
			survivingAssignments[assignmentId] = assignment;
			continue;
		}
		purged = true;
	}

	let nextSessions = current.sessions;
	if (filteredSection) {
		let finalSection = filteredSection;
		if (purged) {
			finalSection = isEmptySection(filteredSection)
				? emptyShimaSection()
				: {
					...filteredSection,
					// Receipts may reference purged work; fail closed to re-execution.
					receipts: {},
				};
		}
		nextSessions = { ...current.sessions, [sessionKey]: finalSection };
	}
	if (!purged) {
		return current;
	}
	return {
		version: 1,
		sessions: nextSessions,
		quests: survivingQuests,
		assignments: survivingAssignments,
	};
}

type SourceIndex = ReturnType<typeof buildSourceIndex>;

type EvidenceRefs = { evidence: { sourceId: string; sourceRev: number; quote: string }[] };

function quantityEvidenceSurvives(
	quantity: EvidenceRefs,
	sources: SourceIndex,
): boolean {
	return quantity.evidence.every((ref) =>
		evidenceRefIsValid(ref, sources),
	);
}

function containsStaleQuote(draft: TaskDraft, staleQuotes: string[]): boolean {
	return Object.values(draft).flat().some((field) =>
		typeof field === 'string' && staleQuotes.some((quote) => field.includes(quote)),
	);
}

function keepEntries<T>(
	entries: Record<string, T>,
	keep: (row: T) => boolean,
): Record<string, T> {
	const next: Record<string, T> = {};
	for (const [id, row] of Object.entries(entries)) {
		if (keep(row)) {
			next[id] = row;
		}
	}
	return next;
}

function isEmptySection(section: ShimaSection): boolean {
	return (
		Object.keys(section.effort).length === 0
		&& Object.keys(section.packages).length === 0
		&& Object.keys(section.previews).length === 0
	);
}
