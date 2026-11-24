// Shared formatting and gate logic for the Shima tracer pages. Pure helpers:
// they keep reported spent time and potential savings visibly separate (a
// weekly spent figure is never re-expressed as a monthly one), render yen and
// dates with exact digits (no locale reformatting of approval-relevant
// numbers), and gate the exact preview on a full catalog match.
import type { Quantity } from '../../shared/shima/schemas';

/**
 * Weekly spent minutes from the two owner-reported inputs. The arithmetic is
 * the same whatever the evidentiary kind; unknown inputs yield unknown.
 */
export function effortMinutesPerWeek(
	weeklyOccurrences: Quantity,
	minutesPerOccurrence: Quantity,
): number | null {
	if (
		weeklyOccurrences.value === null
		|| minutesPerOccurrence.value === null
	) {
		return null;
	}
	return weeklyOccurrences.value * minutesPerOccurrence.value;
}

/** Short label for how a quantity was established. */
export function quantityBasisLabel(quantity: Quantity): string {
	if (quantity.kind === 'owner-reported') {
		return '報告';
	}
	return quantity.kind === 'assumption' ? '仮定' : '不明';
}

/** Weekly spent time, in its own period; never converted to a monthly one. */
export function formatSpentPerWeek(minutesPerWeek: number | null): string {
	return minutesPerWeek === null ? '不明' : `${minutesPerWeek}分/週`;
}

/** Potential savings per month, in its own period. */
export function formatPotentialPerMonth(hoursPerMonth: number | null): string {
	return hoursPerMonth === null ? '不明' : `${hoursPerMonth}時間/月`;
}

/** Exact yen digits; no thousands separators on approval-relevant amounts. */
export function yenDisplay(yen: number): string {
	return `¥${yen}`;
}

export type PreviewInputs = {
	proposedBudgetYen: number | null;
	targetDate: string | null;
};

export type CatalogCommitments = {
	confirmedBudgetYen: number;
	targetDate: string;
};

/**
 * Whether the exact preview can be prepared: both the yen and the date must
 * match the catalog commitment exactly — an unspecified value is never
 * silently substituted.
 */
export function canPreparePreview(
	inputs: PreviewInputs,
	catalog: CatalogCommitments,
): boolean {
	return (
		inputs.proposedBudgetYen !== null
		&& inputs.proposedBudgetYen === catalog.confirmedBudgetYen
		&& inputs.targetDate !== null
		&& inputs.targetDate === catalog.targetDate
	);
}

/** Quest state labels on the engineer board. */
export function questStateLabel(state: 'available' | 'claimed'): string {
	return state === 'available' ? '募集中' : '申し込み済み';
}
