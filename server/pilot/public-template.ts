import { type PublicTask, PublicTaskSchema } from '#shared/shima/schemas';
import { z } from 'zod';

export const PilotReleaseSelectionSchema = z.strictObject({
	template: z.literal('review-checklist-v1'),
	confirmedBudgetYen: PublicTaskSchema.shape.confirmedBudgetYen,
});
export type PilotReleaseSelection = Readonly<
	z.infer<typeof PilotReleaseSelectionSchema>
>;

type ImmutableTask = {
	readonly [K in keyof PublicTask]: PublicTask[K] extends string[] ?
		readonly string[]
	:	PublicTask[K];
};

/** A common deadline, not a precise date chosen for a particular business/package. */
export function isCohortTargetDate(value: unknown): value is string {
	return (
		typeof value === 'string'
		&& value.length === 10
		&& /^[1-9]\d{3}-(03-31|06-30|09-30|12-31)$/u.test(value)
	);
}

/** Accept no prose or per-package dates. The reviewer must still check the exact yen for identifiability. */
export function buildPilotPublicTask(
	selection: PilotReleaseSelection,
	cohortTargetDate: string,
): ImmutableTask {
	const task = PublicTaskSchema.parse({
		title: 'Build a reusable review checklist',
		problem:
			'A recurring review needs a consistent way to record its checks.',
		proposedChange:
			'Create a standalone checklist that can be tried using fictional examples.',
		deliverables: [
			'Reusable checklist',
			'Fictional example and usage notes',
		],
		acceptanceCriteria: [
			'The example shows how to record a completed review.',
		],
		skills: ['Documentation'],
		integrations: [],
		benefits: ['Consistent review records'],
		prerequisites: [],
		limitations: [
			'No live data or integrations. No time-savings estimate is supplied.',
		],
		confirmedBudgetYen: selection.confirmedBudgetYen,
		targetDate: cohortTargetDate,
		estimatedHoursSavedPerMonth: 0,
	});
	for (const value of Object.values(task)) {
		if (Array.isArray(value)) {
			Object.freeze(value);
		}
	}
	return Object.freeze(task);
}
