// UI model tests for the recorded-upload draft flow: draft rows carry their
// recording provenance into the row editor, and the save payload only marks
// the transcript `audio` when recorded rows are actually present.
import {
	acceptsRecordedDraft,
	audioDraftRows,
	draftRowFromSegmentInput,
	transcriptSaveSource,
} from '../../app/composables/workbenchModel';
import type { DraftSegment } from '../../shared/p1/audio';
import assert from 'node:assert/strict';
import test from 'node:test';

const DRAFT: DraftSegment[] = [
	{ speaker: 'Speaker 1', text: '受付です、ご予約ですね。', startMs: 0, endMs: 2400 },
	{ speaker: 'Speaker 2', text: 'はい、先月予約した佐藤です', startMs: 2900, endMs: 5400 },
];

test('draft rows from a recording are marked as recorded material', () => {
	const rows = audioDraftRows(DRAFT);
	assert.equal(rows.length, 2);
	assert.equal(rows[0]?.audio, true);
	assert.equal(rows[0]?.speaker, 'Speaker 1');
	assert.equal(rows[0]?.startMs, 0);
	assert.equal(rows[1]?.endMs, 5400);
});

test('draft rows from other sources are not marked as recorded', () => {
	const row = draftRowFromSegmentInput({ text: 'Pasted row.' });
	assert.equal(row.audio, undefined);
	assert.equal(row.key.startsWith('draft-'), true);
});

test('saving marks `audio` only when recorded rows are present', () => {
	assert.equal(transcriptSaveSource([]), undefined);
	assert.equal(
		transcriptSaveSource([draftRowFromSegmentInput({ text: 'Pasted row.' })]),
		undefined,
	);
	assert.equal(transcriptSaveSource(audioDraftRows(DRAFT)), 'audio');
	const mixed = [
		draftRowFromSegmentInput({ text: 'Pasted row.' }),
		...audioDraftRows(DRAFT),
	];
	assert.equal(transcriptSaveSource(mixed), 'audio');
});

test('null speakers and times map to blank editor fields', () => {
	const rows = audioDraftRows([{ speaker: null, text: 'メモ', startMs: null, endMs: null }]);
	assert.equal(rows[0]?.speaker, '');
	assert.equal(rows[0]?.startMs, '');
	assert.equal(rows[0]?.endMs, '');
});

test('a finished draft may only land when the interview revision is unchanged', () => {
	assert.equal(acceptsRecordedDraft(3, 3), true);
	assert.equal(
		acceptsRecordedDraft(3, 4),
		false,
		'a stale response must not append after a same-session revision change',
	);
});
