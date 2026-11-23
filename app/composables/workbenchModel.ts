import type { SegmentInput } from '#shared/p0/types';

const TIMESTAMP = '(?:\\d{1,3}:)?\\d{1,2}:[0-5]\\d(?:\\.\\d{1,3})?';
const timePrefix = new RegExp(
	`^\\[(${TIMESTAMP})(?: *[-–—→] *(${TIMESTAMP}))?\\] ?`,
);
const bracketedSpeaker = /^\[([^\]\r\n[]{1,48})\] ?/u;
const speakerWithSpace = /^(\p{L}[\p{L}\p{M}\p{N} ._'・-]{0,39})[:：] /u;
const speakerAfterTime = /^(\p{L}[\p{L}\p{M}\p{N} ._'・-]{0,39})[:：] ?/u;

function timestampMs(timestamp: string): number {
	return timestamp
		.split(':')
		.reduce(
			(total, part) => total * 60 + Math.round(Number(part) * 1000),
			0,
		);
}

function parseLine(line: string): SegmentInput {
	const segment = {
		speaker: null,
		text: line,
		startMs: null,
		endMs: null,
	} satisfies SegmentInput;
	const timeMatch = timePrefix.exec(line);
	const startMs = timeMatch?.[1] ? timestampMs(timeMatch[1]) : null;
	const endMs = timeMatch?.[2] ? timestampMs(timeMatch[2]) : null;
	if (
		(startMs !== null && endMs !== null && endMs < startMs)
		|| (!timeMatch && /^\[\d/u.test(line))
	) {
		return segment;
	}

	const remainder = line.slice(timeMatch?.[0].length ?? 0);
	const speakerMatch =
		bracketedSpeaker.exec(remainder)
		?? (timeMatch ? speakerAfterTime : speakerWithSpace).exec(remainder);
	const text = remainder.slice(speakerMatch?.[0].length ?? 0);
	return text.trim() ?
			{ speaker: speakerMatch?.[1] ?? null, text, startMs, endMs }
		:	segment;
}

export function parseTranscriptPaste(raw: string): SegmentInput[] {
	const segments: SegmentInput[] = [];
	let leadingWhitespace = '';
	for (const line of raw.split(/\r\n|\n|\r/u)) {
		if (!line.trim()) {
			const previous = segments.at(-1);
			// A blank-only segment cannot be persisted. Keep paragraph breaks with adjacent text.
			if (previous) {
				previous.text += `\n${line}`;
			} else {
				leadingWhitespace += `${line}\n`;
			}
			continue;
		}
		const segment = parseLine(line);
		segment.text = leadingWhitespace + segment.text;
		leadingWhitespace = '';
		segments.push(segment);
	}
	return segments;
}
