import type { DraftSegment } from '#shared/p1/audio';
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

// ---------------------------------------------------------------------------
// Draft rows: the shared editor row shape, also used by the recorded-upload
// control. Rows derived from a recording are marked `audio` so the save can
// mark the transcript's origin; pasted rows never are.
// ---------------------------------------------------------------------------

export type DraftRow = {
	key: string;
	id?: string;
	text: string;
	speaker: string;
	startMs: number | '';
	endMs: number | '';
	/** Present only on rows that came from a recorded upload draft. */
	audio?: boolean;
};

let rowCounter = 0;

export function draftRowFromSegmentInput(
	input: SegmentInput,
	options: { audio?: boolean } = {},
): DraftRow {
	rowCounter += 1;
	return {
		key: input.id ?? `draft-${rowCounter}`,
		...(input.id ? { id: input.id } : {}),
		text: input.text,
		speaker: input.speaker ?? '',
		startMs: input.startMs ?? '',
		endMs: input.endMs ?? '',
		...(options.audio ? { audio: true } : {}),
	};
}

/** Map an unpersisted transcription draft into editor rows. */
export function audioDraftRows(segments: readonly DraftSegment[]): DraftRow[] {
	return segments.map((segment) =>
		draftRowFromSegmentInput(
			{
				text: segment.text,
				speaker: segment.speaker,
				startMs: segment.startMs,
				endMs: segment.endMs,
			},
			{ audio: true },
		),
	);
}

/**
 * The `source` to send with a transcript save: `audio` only when rows derived
 * from a recording are present; otherwise undefined (the persisted origin is
 * preserved server-side).
 */
export function transcriptSaveSource(rows: readonly DraftRow[]): 'audio' | undefined {
	return rows.some((row) => row.audio === true) ? 'audio' : undefined;
}

/**
 * Whether a finished upload's draft may still be appended to the row editor:
 * the session must not have been revised while the upload was in flight, so a
 * stale response can never append rows across a revision change. Only the
 * append is gated — an intentional CAS save and unsaved pasted draft rows are
 * untouched either way.
 */
export function acceptsRecordedDraft(
	revisionAtRequest: number,
	revisionNow: number,
): boolean {
	return revisionAtRequest === revisionNow;
}
