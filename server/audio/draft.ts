// Group the provider's word-level transcription into review rows: consecutive
// entries with the same speaker form one row; spacing entries inside a row are
// appended exactly as the provider emitted them, and a spacing entry at a row
// boundary is the separator between rows — it is dropped rather than attached
// to either row (nothing is ever inserted, so Japanese stays unspaced).
// Speaker labels stay neutral: numbered provider ids map to "Speaker n+1",
// other labels pass through, and identity is never inferred.
import type { DraftSegment, DraftTranscript } from '../../shared/p1/audio';
import type { ScribeWord } from './provider';
import { StageError } from '../../shared/p0/stages';

const MAX_DRAFT_ROWS = 5000;

type Turn = {
	speakerId: string | null;
	text: string;
	startMs: number | null;
	endMs: number | null;
};

/** Neutral display label for a provider speaker id; identity is not inferred. */
export function speakerLabelOf(speakerId: string | null): string | null {
	if (speakerId === null) {
		return null;
	}
	const numbered = /^speaker_(\d+)$/i.exec(speakerId);
	if (numbered) {
		return `Speaker ${Number(numbered[1]) + 1}`;
	}
	return speakerId;
}

function timeMs(seconds: number | null | undefined): number | null {
	if (
		typeof seconds !== 'number'
		|| !Number.isFinite(seconds)
		|| seconds < 0
	) {
		return null;
	}
	return Math.round(seconds * 1000);
}

/** Build the unpersisted review transcript from validated provider words. */
export function draftTranscriptFromWords(words: readonly ScribeWord[]): DraftTranscript {
	const turns: Turn[] = [];
	let current: Turn | null = null;
	// Spacing cannot be attached when it arrives: whether it belongs inside the
	// current row or between rows is only known once the next word shows who
	// speaks. It is held here until then, and dropped at a row boundary.
	let boundarySpacing = '';

	for (const word of words) {
		if (word.text.length === 0) {
			continue;
		}
		if (word.type !== 'word' && word.type !== 'spacing') {
			// Non-speech audio events (laughter, music) are not spoken text:
			// they never become transcript rows or extend a row's times.
			continue;
		}
		if (word.type === 'spacing') {
			// Spacing belongs to the turn in progress; it never opens one.
			if (current) {
				boundarySpacing += word.text;
			}
			continue;
		}
		const changesSpeaker =
			word.speaker_id !== null
			&& word.speaker_id !== current?.speakerId;
		if (!current || changesSpeaker) {
			boundarySpacing = '';
			current = {
				speakerId: word.speaker_id,
				text: '',
				startMs: null,
				endMs: null,
			};
			turns.push(current);
		} else {
			current.text += boundarySpacing;
			boundarySpacing = '';
		}
		current.text += word.text;
		const start = timeMs(word.start);
		const end = timeMs(word.end);
		if (current.startMs === null && start !== null) {
			current.startMs = start;
		}
		if (end !== null) {
			current.endMs = end;
		}
	}
	if (turns.length > MAX_DRAFT_ROWS) {
		throw new StageError(
			'provider_failed',
			'The transcription produced more rows than the workbench accepts.',
		);
	}
	const segments: DraftSegment[] = [];
	for (const turn of turns) {
		if (turn.text.trim().length === 0) {
			continue;
		}
		// A start without a plausible end (or an inverted range) stays untimed.
		const endMs =
			turn.startMs !== null && turn.endMs !== null && turn.endMs < turn.startMs
				? null
				: turn.endMs;
		segments.push({
			speaker: speakerLabelOf(turn.speakerId),
			text: turn.text,
			startMs: turn.startMs,
			endMs,
		});
	}
	return { source: 'audio', segments };
}
