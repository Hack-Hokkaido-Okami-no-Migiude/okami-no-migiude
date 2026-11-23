// Apply a consultant assumption edit: supplied assumptions replace the stored
// ones, the edited flag is set, and the server-derived savings estimate is
// recomputed as occurrences × minutes ÷ 60 (null when either input is missing;
// zero is a valid estimate).
import type { EvidenceRef, Opportunity } from '../../shared/p0/types';
import { type SourceIndex, assertEvidenceRefs } from './sources';

export type AssumptionInput = {
	value: number | null;
	basis: string;
	evidence: EvidenceRef[];
};

export type AssumptionPatch = {
	monthlyOccurrences?: AssumptionInput;
	minutesSaved?: AssumptionInput;
};

export function hoursSavedPerMonth(assumptions: {
	monthlyOccurrences: { value: number | null };
	minutesSaved: { value: number | null };
}): number | null {
	const occurrences = assumptions.monthlyOccurrences.value;
	const minutes = assumptions.minutesSaved.value;
	if (occurrences === null || minutes === null) {
		return null;
	}
	return (occurrences * minutes) / 60;
}

export function applyAssumptionEdit(
	opportunity: Opportunity,
	patch: AssumptionPatch,
	sources: SourceIndex,
): Opportunity {
	const assumptions = { ...opportunity.assumptions };
	const apply = (which: 'monthlyOccurrences' | 'minutesSaved') => {
		const input = patch[which];
		if (!input) {
			return;
		}
		assertEvidenceRefs(input.evidence, sources);
		assumptions[which] = {
			value: input.value,
			basis: input.basis,
			evidence: [...input.evidence],
			edited: true,
		};
	};
	apply('monthlyOccurrences');
	apply('minutesSaved');
	return {
		...opportunity,
		assumptions,
		hoursSavedPerMonth: hoursSavedPerMonth(assumptions),
	};
}
