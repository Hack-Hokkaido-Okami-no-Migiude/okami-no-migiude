// Evidence validation and transition provenance: quotes must be verbatim
// substrings of current sources, and a quote that merely mentions both endpoint
// names must never produce a graph edge without an explicit transition phrase.
import { baseSession, evidence } from './helpers';
import {
	buildSourceIndex,
	checkTransitionProvenance,
	resolveEvidence,
} from '../../server/analysis/validate';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import test from 'node:test';

test('resolveEvidence accepts a verbatim quote at the current revision', () => {
	const session = baseSession();
	const resolved = resolveEvidence(
		evidence('seg_a', 'receives the reservation email'),
		buildSourceIndex(session),
	);
	assert.deepEqual(resolved, {
		sourceId: 'seg_a',
		sourceRev: 1,
		quote: 'receives the reservation email',
	});
});

test('resolveEvidence rejects unknown sources, stale revisions, and copied quotes', () => {
	const sources = buildSourceIndex(baseSession());
	assert.throws(
		() => resolveEvidence(evidence('seg_missing', 'anything'), sources),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'invalid_model_output'
			&& /unknown source/.test(error.message),
	);
	assert.throws(
		() =>
			resolveEvidence(
				{ sourceId: 'seg_a', sourceRev: 2, quote: 'details' },
				sources,
			),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'invalid_model_output'
			&& /outdated revision/.test(error.message),
	);
	assert.throws(
		() =>
			resolveEvidence(
				evidence('seg_a', 'a quote that was never written'),
				sources,
			),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'invalid_model_output'
			&& /verbatim substring/.test(error.message),
	);
});

test('both endpoint anchors plus an explicit transition phrase are accepted', () => {
	const check = checkTransitionProvenance({
		quote: 'After reading the email, the clerk types the booking into the PMS.',
		fromAnchor: 'reading the email',
		toAnchor: 'types the booking into the PMS',
	});
	assert.deepEqual(check, { accepted: true });
});

test('a valid quote naming both endpoints without a transition phrase is rejected', () => {
	const check = checkTransitionProvenance({
		quote: 'Clerks use the PMS all day, and housekeeping keeps the schedule sheet in Excel.',
		fromAnchor: 'the PMS',
		toAnchor: 'schedule sheet in Excel',
	});
	if (check.accepted) {
		throw new Error(
			'co-occurrence without a transition phrase must be rejected',
		);
	}
	assert.equal(check.reason, 'no_transition_phrase');
	assert.match(
		check.detail,
		/no explicit trigger, handoff, or sequence phrase/,
	);
});

test('a missing endpoint anchor is rejected before the phrase check', () => {
	const check = checkTransitionProvenance({
		quote: 'After reading the email, the clerk types the booking into the PMS.',
		fromAnchor: 'reading the email',
		toAnchor: 'housekeeping desk',
	});
	if (check.accepted) {
		throw new Error('a missing anchor must be rejected');
	}
	assert.equal(check.reason, 'missing_anchor');
});

test('common trigger, handoff, and sequence phrasings are recognized', () => {
	const accepted = [
		{
			quote: 'Once the booking is saved, the system sends the confirmation.',
			fromAnchor: 'the booking is saved',
			toAnchor: 'sends the confirmation',
		},
		{
			quote: 'When two emails arrive, the clerk decides which one to keep.',
			fromAnchor: 'two emails arrive',
			toAnchor: 'decides which one to keep',
		},
		{
			quote: 'The night clerk prints the list and walks it over to housekeeping.',
			fromAnchor: 'prints the list',
			toAnchor: 'housekeeping',
		},
		{
			quote: 'Every morning the list is retyped into Excel.',
			fromAnchor: 'Every morning',
			toAnchor: 'retyped into Excel',
		},
		{
			quote: 'They then retype the arrivals into their own sheet.',
			fromAnchor: 'They',
			toAnchor: 'their own sheet',
		},
	];
	for (const candidate of accepted) {
		const check = checkTransitionProvenance(candidate);
		assert.deepEqual(
			check,
			{ accepted: true },
			`rejected: ${candidate.quote}`,
		);
	}
});
