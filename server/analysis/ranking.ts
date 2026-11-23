// Opportunity ranking: known-factor mean with low/medium/high weighted 1/2/3,
// effort and risk inverted (a low score there is good). Ties break by more known
// factors, then by id; opportunities with no known factors rank last. Pure and
// deterministic so persisted sessions keep a stable, explainable order.
import type { Opportunity } from '../../shared/p0/types';

const LEVEL_WEIGHTS = { low: 1, medium: 2, high: 3 } as const;

/** Factors where a lower level is the favorable direction. */
const INVERTED_FACTORS = new Set(['effort', 'risk']);

function factorWeight(
	factor: keyof Opportunity['factors'],
	level: 'low' | 'medium' | 'high',
): number {
	const weight = LEVEL_WEIGHTS[level];
	return INVERTED_FACTORS.has(factor) ? 4 - weight : weight;
}

/** Mean weight over known factors; `null` when every factor is unknown. */
export function opportunityScore(opportunity: Opportunity): number | null {
	let total = 0;
	let known = 0;
	for (const [factor, claim] of Object.entries(opportunity.factors) as [
		keyof Opportunity['factors'],
		Opportunity['factors'][keyof Opportunity['factors']],
	][]) {
		if (claim.value === null) {
			continue;
		}
		total += factorWeight(factor, claim.value);
		known += 1;
	}
	return known === 0 ? null : total / known;
}

/** Rank opportunities best-first; returns a new array without mutating input. */
export function rankOpportunities(opportunities: Opportunity[]): Opportunity[] {
	return [...opportunities].sort((left, right) => {
		const leftScore = opportunityScore(left);
		const rightScore = opportunityScore(right);
		// All-unknown opportunities rank last, below any scored opportunity.
		if (leftScore === null || rightScore === null) {
			if (leftScore === rightScore) {
				return compareIds(left.id, right.id);
			}
			return leftScore === null ? 1 : -1;
		}
		if (leftScore !== rightScore) {
			return rightScore - leftScore;
		}
		const leftKnown = countKnownFactors(left);
		const rightKnown = countKnownFactors(right);
		if (leftKnown !== rightKnown) {
			return rightKnown - leftKnown;
		}
		return compareIds(left.id, right.id);
	});
}

function countKnownFactors(opportunity: Opportunity): number {
	return Object.values(opportunity.factors).filter(
		(claim) => claim.value !== null,
	).length;
}

function compareIds(left: string, right: string): number {
	return (
		left < right ? -1
		: left > right ? 1
		: 0
	);
}
