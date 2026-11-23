import type { FactorClaim, Opportunity } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import test from 'node:test';

function opportunity(
	id: string,
	values: Partial<Record<keyof Opportunity['factors'], FactorClaim['value']>>,
) {
	const factor = (value: FactorClaim['value'] = null): FactorClaim => ({
		value,
		evidence: [],
		author: 'analysis',
		state: value === null ? 'unknown' : 'client-confirmed',
	});
	return {
		id,
		factors: {
			impact: factor(values.impact),
			frequency: factor(values.frequency),
			effort: factor(values.effort),
			feasibility: factor(values.feasibility),
			risk: factor(values.risk),
		},
	};
}

test('ranking inverts cost factors, then breaks equal means by coverage and stable ID', async () => {
	const { rankOpportunities } =
		await import('../../app/composables/opportunityRanking');
	const input = [
		opportunity('unknown', {}),
		opportunity('z', { impact: 'high' }),
		opportunity('a', { risk: 'low' }),
		opportunity('two', { impact: 'high', effort: 'low' }),
		opportunity('last-known', { impact: 'high', effort: 'high' }),
	];
	assert.deepEqual(
		rankOpportunities(input).map(({ item }) => item.id),
		['two', 'a', 'z', 'last-known', 'unknown'],
	);
});
