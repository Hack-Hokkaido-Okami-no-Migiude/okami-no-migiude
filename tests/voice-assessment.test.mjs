// Unit tests for the Dify streaming report extractor (leaf module, no
// relative imports — the repo's only plain-Node-testable server modules are
// leaves). The full assessment pipeline (queue → Dify run → report row →
// owner mail) is exercised end to end by tests/voice-journey.test.mjs
// against a loopback Dify stub.
// Run: node --test tests/voice-assessment.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { readDifyReport } from '../server/voice/dify-stream.ts';

function textStream(chunks) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(new TextEncoder().encode(chunk));
			}
			controller.close();
		},
	});
}

test('readDifyReport reassembles SSE split across chunk boundaries', async () => {
	const report = '# レポート\n\n## まとめ\n- 本文';
	// Cut mid-key and mid-line to prove the line buffer works.
	const chunks = [
		'data: {"event": "workflow_star',
		'ted", "data": {"id": "wfr_1"}}\n\ndata: {"event": "te',
		'xt_chunk"}\n\ndata: {"event": "workflow_finished", "data": {"status": "succeeded", "outputs": {"repor',
		`t": ${JSON.stringify(report)}}}}\n\n`,
	];
	assert.equal(await readDifyReport(textStream(chunks)), report);
});

test('readDifyReport keeps only the workflow_finished report and trims it', async () => {
	const chunks = [
		': keepalive\n',
		'data: not-json\n\n',
		'data: {"event": "node_started"}\r\n\r\n',
		'data: {"event": "text_chunk", "data": {"text": "partial"}}\n\n',
		'data: {"event": "workflow_finished", "data": {"status": "succeeded", "outputs": {"report": "  # 評価レポート\\n\\n本文  "}}}\n\n',
		'data: [DONE]\n\n',
	];
	assert.equal(
		await readDifyReport(textStream(chunks)),
		'# 評価レポート\n\n本文',
	);
});

test('readDifyReport fails honestly on an error event', async () => {
	await assert.rejects(
		() =>
			readDifyReport(
				textStream([
					'data: {"event": "workflow_started"}\n\n',
					'data: {"event": "error", "data": {"status": "failed"}}\n\n',
				]),
			),
		/Dify workflow reported an error/,
	);
});

test('readDifyReport rejects a succeeded run without a report', async () => {
	await assert.rejects(
		() =>
			readDifyReport(
				textStream([
					'data: {"event": "workflow_finished", "data": {"status": "succeeded", "outputs": {}}}\n\n',
				]),
			),
		/Dify workflow did not produce a report/,
	);
});

test('readDifyReport rejects a failed run and an empty stream', async () => {
	await assert.rejects(
		() =>
			readDifyReport(
				textStream([
					'data: {"event": "workflow_finished", "data": {"status": "failed"}}\n\n',
				]),
			),
		/Dify workflow did not produce a report/,
	);
	await assert.rejects(
		() => readDifyReport(textStream(['data: [DONE]\n\n'])),
		/Dify did not return a report/,
	);
});
