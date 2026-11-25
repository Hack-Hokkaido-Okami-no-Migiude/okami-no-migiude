// Transcript validation and scripted-dialogue rendering. The server accepts a
// non-empty transcript of at most 200,000 characters after trimming (contract
// §5); the client enforces the same rules before ever sending. Pure module.

export const TRANSCRIPT_MAX_CHARS = 200_000;

export type TranscriptCheck =
	{ ok: true; value: string } | { ok: false; reason: 'empty' | 'too_long' };

export function checkTranscript(raw: string): TranscriptCheck {
	const value = raw.trim();
	if (value.length === 0) {
		return { ok: false, reason: 'empty' };
	}
	if (value.length > TRANSCRIPT_MAX_CHARS) {
		return { ok: false, reason: 'too_long' };
	}
	return { ok: true, value };
}

export type ScriptLine = { speaker: 'interviewer' | 'owner'; text: string };

export type SpeakerLabels = { interviewer: string; owner: string };

/** Renders script lines as `Label: text` rows joined by newlines. */
export function renderScriptTranscript(
	lines: readonly ScriptLine[],
	labels: SpeakerLabels,
): string {
	return lines
		.map((line) => {
			const label =
				line.speaker === 'interviewer' ?
					labels.interviewer
				:	labels.owner;
			return `${label}: ${line.text}`;
		})
		.join('\n');
}

/** Replaces `{key}` placeholders in a UI string. */
export function fillTemplate(
	template: string,
	values: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) => {
		const value = values[key];
		return value === undefined ? match : String(value);
	});
}
