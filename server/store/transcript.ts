// Apply a transcript PUT body: rows without an id are created, rows with an id
// replace the persisted row (all editable fields required), and array order is
// the new row order. `source` (P1) marks transcripts that contain recorded-
// upload rows; when omitted the persisted origin is preserved (or `paste` for
// a new transcript). `sourceRev` increments only when a row's content actually
// changes — never on reorder — and a removed id can never be reused.
import type {
	Segment,
	SegmentInput,
	Transcript,
	TranscriptSource,
} from '../../shared/p0/types';
import { StoreInputError } from './errors';
import { newId } from './ids';

export function applyTranscriptInput(
	current: Transcript | null,
	inputs: readonly SegmentInput[],
	source?: TranscriptSource,
): { transcript: Transcript } {
	const previousById = new Map(
		(current?.segments ?? []).map((segment) => [segment.id, segment]),
	);
	const submittedIds = new Set<string>();
	const segments: Segment[] = [];

	for (const input of inputs) {
		if (input.id === undefined) {
			segments.push({
				id: newId('seg'),
				sourceRev: 1,
				speaker: input.speaker ?? null,
				text: input.text,
				startMs: input.startMs ?? null,
				endMs: input.endMs ?? null,
			});
			continue;
		}
		if (submittedIds.has(input.id)) {
			throw new StoreInputError(
				`Segment '${input.id}' appears more than once in the transcript.`,
			);
		}
		submittedIds.add(input.id);
		const previous = previousById.get(input.id);
		if (!previous) {
			throw new StoreInputError(
				`Segment '${input.id}' does not exist in the current transcript; removed or unknown ids cannot be reused.`,
			);
		}
		if (
			input.speaker === undefined
			|| input.startMs === undefined
			|| input.endMs === undefined
		) {
			throw new StoreInputError(
				`Editing segment '${input.id}' requires all editable fields (speaker, text, startMs, endMs).`,
			);
		}
		const changed =
			previous.speaker !== input.speaker
			|| previous.text !== input.text
			|| previous.startMs !== input.startMs
			|| previous.endMs !== input.endMs;
		segments.push({
			id: previous.id,
			sourceRev: changed ? previous.sourceRev + 1 : previous.sourceRev,
			speaker: input.speaker,
			text: input.text,
			startMs: input.startMs,
			endMs: input.endMs,
		});
	}

	return {
		transcript: {
			source: source ?? current?.source ?? 'paste',
			segments,
		},
	};
}
