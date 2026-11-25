// Dify streaming response handling: the report extractor for the workflow
// run's text/event-stream plus its wall-clock timeout constant. A leaf
// module with no relative imports, so it stays directly unit-testable under
// plain Node (see tests/voice-assessment.test.mjs).
export type DifyRecord = Record<string, unknown>;

export function isObject(value: unknown): value is DifyRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Wall-clock cap on one Dify streaming run (agent research loops take
 * minutes). The assessment deadline is derived from this with headroom so a
 * healthy long run is never reaped by the worker.
 */
export const DIFY_RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * Reads a Dify streaming workflow run to completion and returns the report
 * text from the workflow_finished event. Errors are static strings — event
 * payloads never reach error messages (no transcript or internals leak).
 */
export async function readDifyReport(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let report: string | null = null;
	let failure: string | null = null;
	const consumeLine = (rawLine: string): void => {
		const line = rawLine.trimEnd();
		if (!line.startsWith('data:')) {
			return;
		}
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') {
			return;
		}
		let event: unknown;
		try {
			event = JSON.parse(payload);
		} catch {
			return;
		}
		if (!isObject(event)) {
			return;
		}
		if (event.event === 'workflow_finished') {
			const data = isObject(event.data) ? event.data : undefined;
			const outputs =
				data && isObject(data.outputs) ? data.outputs : undefined;
			const text =
				outputs && typeof outputs.report === 'string' ?
					outputs.report.trim()
				:	'';
			if (data?.status === 'succeeded' && text) {
				report = text;
			} else {
				failure = 'Dify workflow did not produce a report';
			}
			return;
		}
		if (event.event === 'error') {
			failure = 'Dify workflow reported an error';
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (value) {
			buffer += decoder.decode(value, { stream: true });
			let newline: number;
			while ((newline = buffer.indexOf('\n')) >= 0) {
				consumeLine(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
			}
		}
		if (done) {
			break;
		}
	}
	buffer += decoder.decode();
	if (buffer) {
		consumeLine(buffer);
	}
	if (report !== null) {
		return report;
	}
	throw new Error(failure ?? 'Dify did not return a report');
}
