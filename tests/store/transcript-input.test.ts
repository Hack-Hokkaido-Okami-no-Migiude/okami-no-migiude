// Store unit tests: transcript PUT semantics — creation, edits by id, reorder
// without revision bumps, and rejection of removed/unknown/duplicate ids.
import { StoreInputError } from '../../server/store/errors';
import { applyTranscriptInput } from '../../server/store/transcript';
import assert from 'node:assert/strict';
import { makeSession } from './helpers/fixture';
import test from 'node:test';

const current = makeSession().transcript;

test('creates new rows without ids at sourceRev 1', () => {
	const { transcript } = applyTranscriptInput(null, [
		{ text: 'First row.' },
		{ text: 'Second row.', speaker: 'Clerk', startMs: 0, endMs: 5 },
	]);
	assert.equal(transcript.source, 'paste');
	assert.equal(transcript.segments.length, 2);
	const [first, second] = transcript.segments;
	assert.match(first?.id ?? '', /^seg_/);
	assert.equal(first?.sourceRev, 1);
	assert.equal(first?.speaker, null);
	assert.equal(first?.startMs, null);
	assert.equal(second?.speaker, 'Clerk');
	assert.equal(second?.startMs, 0);
	assert.equal(second?.endMs, 5);
	assert.notEqual(first?.id, second?.id);
});

test('edits by id bump sourceRev only for changed rows; reorder keeps revisions', () => {
	const { transcript } = applyTranscriptInput(current, [
		{
			id: 'seg_src2',
			speaker: 'Interviewer',
			text: 'Then housekeeping retype the list into their sheet.',
			startMs: null,
			endMs: null,
		},
		{
			id: 'seg_src1',
			speaker: 'Interviewer',
			text: 'The clerk types every booking into the PMS by hand, slowly.',
			startMs: null,
			endMs: null,
		},
	]);
	const [second, first] = transcript.segments;
	assert.equal(second?.id, 'seg_src2');
	assert.equal(second?.sourceRev, 1, 'unchanged row must not bump on reorder');
	assert.equal(first?.id, 'seg_src1');
	assert.equal(first?.sourceRev, 2, 'changed row bumps sourceRev');
	assert.equal(
		first?.text,
		'The clerk types every booking into the PMS by hand, slowly.',
	);
});

test('rejects removed or unknown ids', () => {
	assert.throws(
		() =>
			applyTranscriptInput(current, [
				{
					id: 'seg_gone',
					speaker: null,
					text: 'Reused id',
					startMs: null,
					endMs: null,
				},
			]),
		StoreInputError,
	);
});

test('rejects duplicate ids in one submission', () => {
	assert.throws(
		() =>
			applyTranscriptInput(current, [
				{
					id: 'seg_src1',
					speaker: null,
					text: 'First copy',
					startMs: null,
					endMs: null,
				},
				{
					id: 'seg_src1',
					speaker: null,
					text: 'Second copy',
					startMs: null,
					endMs: null,
				},
			]),
		StoreInputError,
	);
});

test('edits must send all editable fields', () => {
	assert.throws(
		() => applyTranscriptInput(current, [{ id: 'seg_src1', text: 'Only text' }]),
		StoreInputError,
	);
});

test('an explicit audio source is recorded and preserved by later edits', () => {
	const created = applyTranscriptInput(
		null,
		[{ text: '受付です、ご予約ですね。', speaker: 'Speaker 1', startMs: 0, endMs: 2400 }],
		'audio',
	);
	assert.equal(created.transcript.source, 'audio');
	const [saved] = created.transcript.segments;
	const edited = applyTranscriptInput(created.transcript, [
		{
			id: saved?.id ?? '',
			speaker: '受付',
			text: '受付です、ご予約ですね。',
			startMs: 0,
			endMs: 2400,
		},
	]);
	assert.equal(
		edited.transcript.source,
		'audio',
		'an omitted source preserves the persisted origin',
	);
});
