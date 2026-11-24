import type { PublicTask, Quantity, TaskDraft } from '#shared/shima/schemas';

export type ShimaEffortRow = {
	stepId: string;
	weeklyOccurrences: Quantity;
	minutesPerOccurrence: Quantity;
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

export type ShimaPackageView = {
	id: string;
	opportunityId: string;
	state: 'draft' | 'published';
	stale: boolean;
	ownerDecision: 'accept' | 'decline' | null;
	completed: boolean;
	previewId: string | null;
	questId: string | null;
	draft: TaskDraft;
};

export type ShimaPreview = { id: string; hash: string; task: PublicTask };
export type ShimaQuestState = 'available' | 'claimed';
export type ShimaQuestSummary = {
	id: string;
	rev: number;
	state: ShimaQuestState;
	title: string;
	confirmedBudgetYen: number;
	targetDate: string;
};
export type ShimaQuestDetail = Pick<
	ShimaQuestSummary,
	'id' | 'rev' | 'state'
> & { task: PublicTask };
