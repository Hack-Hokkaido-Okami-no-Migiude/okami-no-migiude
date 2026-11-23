// Store unit tests: boundary evidence validation — references must point at an
// active segment or answer in the same session, at its current revision, and
// quote a verbatim substring of the stored original text.
import {
	answerRecord,
	evidence,
	makeSession,
	question,
} from './helpers/fixture';
import {
	assertEvidenceRefs,
	buildSourceIndex,
	evidenceRefIsValid,
} from '../../server/store/sources';
import { StoreInputError } from '../../server/store/errors';
import assert from 'node:assert/strict';
import test from 'node:test';

test('valid segment references pass and answer sources are citable', () => {
	const withAnswer = makeSession({
		questions: [
			question('q_1', 'step_1', 'tool', {
				status: 'answered',
				answer: answerRecord('ans_1', 'The tool is YukiReserve.'),
			}),
		],
	});
	const sources = buildSourceIndex(withAnswer);

	assert.doesNotThrow(() =>
		assertEvidenceRefs(
			[evidence('seg_src1', 1, 'types every booking into the PMS')],
			sources,
		),
	);
	assert.doesNotThrow(() =>
		assertEvidenceRefs([evidence('ans_1', 1, 'The tool is YukiReserve.')], sources),
	);
	assert.equal(
		evidenceRefIsValid(evidence('ans_1', 1, 'The tool is YukiReserve.'), sources),
		true,
	);
});

test('unknown, outdated, and fabricated references are rejected', () => {
	const sources = buildSourceIndex(makeSession());

	assert.throws(
		() => assertEvidenceRefs([evidence('seg_nope', 1, 'anything')], sources),
		StoreInputError,
	);
	assert.throws(
		() =>
			assertEvidenceRefs(
				[evidence('seg_src1', 2, 'types every booking into the PMS')],
				sources,
			),
		StoreInputError,
	);
	assert.throws(
		() =>
			assertEvidenceRefs(
				[evidence('seg_src1', 1, 'this wording appears nowhere')],
				sources,
			),
		StoreInputError,
	);
	assert.equal(
		evidenceRefIsValid(evidence('seg_src1', 2, 'anything'), sources),
		false,
	);
});

test('cross-session sources do not resolve', () => {
	const sources = buildSourceIndex(makeSession({ id: 'ses_a' }));
	assert.throws(
		() =>
			assertEvidenceRefs(
				// The quote exists in another session's transcript, not this one.
				[evidence('seg_other', 1, 'The clerk types every booking')],
				sources,
			),
		StoreInputError,
	);
});
