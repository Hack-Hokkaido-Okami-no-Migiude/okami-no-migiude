import { FACTOR_NAMES } from '#shared/p0/schemas';
import type { Opportunity } from '#shared/p0/types';

const weights = { low: 1, medium: 2, high: 3 };

export function rankOpportunities<
	T extends Pick<Opportunity, 'id' | 'factors'>,
>(opportunities: T[]) {
	return opportunities
		.map((item) => {
			const scores = FACTOR_NAMES.flatMap((name) => {
				const { value } = item.factors[name];
				if (value === null) {
					return [];
				}
				return [
					name === 'effort' || name === 'risk' ?
						4 - weights[value]
					:	weights[value],
				];
			});
			const known = scores.length;
			const score =
				known ?
					scores.reduce((total, value) => total + value, 0) / known
				:	null;
			return { item, score, known };
		})
		.sort(
			(left, right) =>
				(right.score ?? 0) - (left.score ?? 0)
				|| right.known - left.known
				|| (left.item.id < right.item.id ?
					-1
				:	Number(left.item.id > right.item.id)),
		);
}
