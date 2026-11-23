// Opportunity ranking: known-factor mean (low/medium/high = 1/2/3, effort and
// risk inverted), tie-break by more known factors then id, all-unknown last.
import {
	opportunityScore,
	rankOpportunities,
} from '../../server/analysis/ranking';
import type { Opportunity } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import { evidenceRef } from './helpers';
import test from 'node:test';

function factorClaim(
	level: 'low' | 'medium' | 'high' | null,
): Opportunity['factors']['impact'] {
	return {
		value: level,
		state: level === null ? 'unknown' : 'inferred',
		author: 'analysis',
		evidence:
			level === null ?
				[]
			:	[evidenceRef('seg_b', 'types the booking into the PMS')],
		inference:
			level === null ? undefined : (
				'Inferred from the cited interview text.'
			),
	};
}

function opportunity(
	id: string,
	factors: Partial<
		Record<
			'impact' | 'frequency' | 'effort' | 'feasibility' | 'risk',
			'low' | 'medium' | 'high' | null
		>
	>,
): Opportunity {
	return {
		id,
		title: `Opportunity ${id}`,
		strategy: 'rules',
		stepIds: ['step_a'],
		evidence: [evidenceRef('seg_b', 'types the booking into the PMS')],
		rationale: 'Test opportunity.',
		factors: {
			impact: factorClaim(factors.impact ?? null),
			frequency: factorClaim(factors.frequency ?? null),
			effort: factorClaim(factors.effort ?? null),
			feasibility: factorClaim(factors.feasibility ?? null),
			risk: factorClaim(factors.risk ?? null),
		},
		benefits: [],
		prerequisites: [],
		risks: [],
		unknowns: [],
		assumptions: {
			monthlyOccurrences: {
				value: null,
				basis: 'unset',
				evidence: [],
				edited: false,
			},
			minutesSaved: {
				value: null,
				basis: 'unset',
				evidence: [],
				edited: false,
			},
		},
		hoursSavedPerMonth: null,
	};
}

test('known-factor mean ranks opportunities with effort and risk inverted', () => {
	const strong = opportunity('opp_strong', {
		impact: 'high',
		frequency: 'high',
		effort: 'low',
		feasibility: 'high',
		risk: 'low',
	});
	const medium = opportunity('opp_medium', {
		impact: 'medium',
		frequency: 'medium',
		effort: 'medium',
		feasibility: 'medium',
		risk: 'medium',
	});
	// High effort and high risk are unfavorable, so this ranks below `medium`:
	// (impact 3 + frequency 3 + effort 1 + feasibility 1 + risk 1) / 5 = 1.8.
	const risky = opportunity('opp_risky', {
		impact: 'high',
		frequency: 'high',
		effort: 'high',
		feasibility: 'low',
		risk: 'high',
	});
	const ranked = rankOpportunities([risky, medium, strong]);
	assert.deepEqual(
		ranked.map((entry) => entry.id),
		['opp_strong', 'opp_medium', 'opp_risky'],
	);
	assert.equal(opportunityScore(strong), 3);
	assert.equal(opportunityScore(medium), 2);
	assert.equal(opportunityScore(risky), 1.8);
});

test('ties break by more known factors, then by id; all-unknown ranks last', () => {
	const twoKnown = opportunity('opp_two', {
		impact: 'high',
		frequency: 'high',
	});
	// Same mean as opp_two: effort low and risk low are both inverted to 3.
	const twoKnownTie = opportunity('opp_tie', {
		effort: 'low',
		risk: 'low',
	});
	const oneKnown = opportunity('opp_one', { impact: 'high' });
	const allUnknown = opportunity('opp_unknown', {});
	const ranked = rankOpportunities([
		allUnknown,
		oneKnown,
		twoKnownTie,
		twoKnown,
	]);
	assert.deepEqual(
		ranked.map((entry) => entry.id),
		['opp_tie', 'opp_two', 'opp_one', 'opp_unknown'],
	);
	assert.equal(opportunityScore(twoKnown), 3);
	assert.equal(opportunityScore(twoKnownTie), 3);
	assert.equal(opportunityScore(oneKnown), 3);
	assert.equal(opportunityScore(allUnknown), null);
});
