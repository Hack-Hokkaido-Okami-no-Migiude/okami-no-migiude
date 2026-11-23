import assert from 'node:assert/strict';
import test from 'node:test';

test('pasted Japanese keeps its exact wording and recognizes explicit speaker and time metadata', async () => {
	const { parseTranscriptPaste } =
		await import('../../app/composables/workbenchModel');
	assert.deepEqual(
		parseTranscriptPaste(
			'[00:01.500–00:04] 受付：ご予約ですね。  \r\n備考：消さない\r\n台帳を確認します。\r\n[01:01:02.500] [Front desk] Keep line',
		),
		[
			{
				speaker: '受付',
				text: 'ご予約ですね。  ',
				startMs: 1500,
				endMs: 4000,
			},
			{
				speaker: null,
				text: '備考：消さない',
				startMs: null,
				endMs: null,
			},
			{
				speaker: null,
				text: '台帳を確認します。',
				startMs: null,
				endMs: null,
			},
			{
				speaker: 'Front desk',
				text: 'Keep line',
				startMs: 3662500,
				endMs: null,
			},
		],
	);
});

test('metadata resembling prose or invalid ranges stays verbatim', async () => {
	const { parseTranscriptPaste } =
		await import('../../app/composables/workbenchModel');
	const lines = [
		'[00:22–00:11] 受付：原文',
		'https://example.test/',
		'  予約：2室',
	];
	assert.deepEqual(
		parseTranscriptPaste(lines.join('\n')).map(({ text }) => text),
		lines,
	);
});
