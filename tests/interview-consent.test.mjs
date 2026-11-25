// Unit tests for the consent gate predicate.
import {
	allConsentsGiven,
	emptyConsents,
} from '../app/utils/interview-consent.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

test('emptyConsents starts fully unchecked', () => {
	assert.deepEqual(emptyConsents(), {
		processing: false,
		privacy: false,
		staff: false,
	});
});

test('allConsentsGiven requires every disclosure acknowledged', () => {
	assert.equal(allConsentsGiven(emptyConsents()), false);
	assert.equal(
		allConsentsGiven({ processing: true, privacy: false, staff: false }),
		false,
	);
	assert.equal(
		allConsentsGiven({ processing: true, privacy: true, staff: false }),
		false,
	);
	assert.equal(
		allConsentsGiven({ processing: true, privacy: true, staff: true }),
		true,
	);
});
