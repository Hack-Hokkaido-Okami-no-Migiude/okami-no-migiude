// The owner's map view: current discovery gaps, per-step owner-reported
// effort, and the fresh proposal picture. Pure projection — the routes only
// add routing and commits.
import type { Session } from '../../shared/p0/types';
import type { ShimaSection } from './storage';

export type ShimaEffortRow = {
	stepId: string;
	weeklyOccurrences: ShimaSection['effort'][string]['weeklyOccurrences'];
	minutesPerOccurrence: ShimaSection['effort'][string]['minutesPerOccurrence'];
	minutesSpentPerWeek: number | null;
};

export type ShimaMapView = {
	rev: number;
	stale: boolean;
	manualEffort: ShimaEffortRow[];
	gaps: { questionId: string; prompt: string }[];
	opportunities: {
		opportunityId: string;
		estimatedHoursSavedPerMonth: number | null;
	}[];
};

export function shimaMapView(
	session: Session,
	section: ShimaSection,
): ShimaMapView {
	return {
		rev: section.rev,
		stale: session.discovery === null || session.discovery.stale,
		manualEffort: Object.values(section.effort)
			.map((row) => ({
				stepId: row.stepId,
				weeklyOccurrences: row.weeklyOccurrences,
				minutesPerOccurrence: row.minutesPerOccurrence,
				minutesSpentPerWeek:
					row.weeklyOccurrences.value === null
					|| row.minutesPerOccurrence.value === null
						? null
						: row.weeklyOccurrences.value * row.minutesPerOccurrence.value,
			}))
			.sort((left, right) => (left.stepId < right.stepId ? -1 : left.stepId > right.stepId ? 1 : 0)),
		gaps: session.questions
			.filter((question) => question.status === 'open')
			.map((question) => ({
				questionId: question.id,
				prompt: question.prompt,
			})),
		opportunities: session.opportunities
			.map((opportunity) => ({
				opportunityId: opportunity.id,
				estimatedHoursSavedPerMonth: opportunity.hoursSavedPerMonth,
			}))
			.sort((left, right) =>
				left.opportunityId < right.opportunityId
					? -1
					: left.opportunityId > right.opportunityId
						? 1
						: 0,
			),
	};
}
