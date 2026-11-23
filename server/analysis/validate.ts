// Stage validators: schema checks plus provenance validation of provider output
// against the session's own source texts. Provenance validation establishes that
// citations point at real, current wording — it is not factual certification of
// the claims themselves.
import {
	type AssessOutput,
	AssessOutputSchema,
	type EvidenceCandidate,
	type ExtractOutput,
	ExtractOutputSchema,
	type ProposeOutput,
	ProposeOutputSchema,
	StageError,
} from '../../shared/p0/stages';
import type { EvidenceRef, Session, Transcript } from '../../shared/p0/types';
import type { z } from 'zod';

/** Every citable source in one session: transcript segments plus saved answers. */
export type SourceIndex = Map<string, { sourceRev: number; text: string }>;

export function buildSourceIndex(session: Session): SourceIndex {
	const index: SourceIndex = new Map();
	const transcript: Transcript | null = session.transcript;
	if (transcript) {
		for (const segment of transcript.segments) {
			index.set(segment.id, {
				sourceRev: segment.sourceRev,
				text: segment.text,
			});
		}
	}
	for (const question of session.questions) {
		if (question.answer) {
			index.set(question.answer.id, {
				sourceRev: question.answer.sourceRev,
				text: question.answer.text,
			});
		}
	}
	return index;
}

/**
 * Validate an evidence candidate against the session's own sources and resolve it
 * to a persisted `EvidenceRef`. Rejects unknown sources, outdated revisions, and
 * quotes that are not verbatim substrings of the stored original text.
 */
export function resolveEvidence(
	candidate: EvidenceCandidate,
	sources: SourceIndex,
): EvidenceRef {
	const source = sources.get(candidate.sourceId);
	if (!source) {
		throw new StageError(
			'invalid_model_output',
			`Evidence cites unknown source '${candidate.sourceId}'.`,
		);
	}
	if (source.sourceRev !== candidate.sourceRev) {
		throw new StageError(
			'invalid_model_output',
			`Evidence cites outdated revision for source '${candidate.sourceId}'.`,
		);
	}
	if (!source.text.includes(candidate.quote)) {
		throw new StageError(
			'invalid_model_output',
			`Evidence quote for source '${candidate.sourceId}' is not a verbatim substring of the stored text.`,
		);
	}
	return {
		sourceId: candidate.sourceId,
		sourceRev: candidate.sourceRev,
		quote: candidate.quote,
	};
}

/**
 * An explicit trigger/handoff/sequence phrase is required before an edge may be
 * created; two endpoint mentions alone never justify a transition.
 */
const TRANSITION_PHRASE_PATTERN =
	/\b(once|when|whenever|while|after|afterwards|before|until|upon|if|then|next|subsequently|finally|every|daily|weekly|monthly|each morning|each day|each week|each month|as soon as|hands? (?:it|this|that|them|the [a-z]+(?: [a-z]+)?) over to|sends? (?:it|this|that|them|the [a-z]+(?: [a-z]+)?) to|passes? (?:it|this|that|them|the [a-z]+(?: [a-z]+)?) to|walks? (?:it|this|that|them|the [a-z]+(?: [a-z]+)?)? ?over to|forwards? (?:it|this|that|them|the [a-z]+(?: [a-z]+)?) to|moves? on to|followed by)\b/i;

export type TransitionCheck =
	| { accepted: true }
	| {
			accepted: false;
			reason: 'no_transition_phrase' | 'missing_anchor';
			detail: string;
	  };

/** The system-side re-verification of a candidate transition against its quote. */
export function checkTransitionProvenance(input: {
	quote: string;
	fromAnchor: string;
	toAnchor: string;
}): TransitionCheck {
	const { quote, fromAnchor, toAnchor } = input;
	if (!quote.includes(fromAnchor) || !quote.includes(toAnchor)) {
		return {
			accepted: false,
			reason: 'missing_anchor',
			detail: 'The cited quote does not contain both endpoint anchors.',
		};
	}
	if (!TRANSITION_PHRASE_PATTERN.test(quote)) {
		return {
			accepted: false,
			reason: 'no_transition_phrase',
			detail: 'The cited quote mentions both steps but contains no explicit trigger, handoff, or sequence phrase.',
		};
	}
	return { accepted: true };
}

export function parseExtractOutput(raw: unknown): ExtractOutput {
	return parseStageOutput(ExtractOutputSchema, raw);
}

export function parseAssessOutput(raw: unknown): AssessOutput {
	return parseStageOutput(AssessOutputSchema, raw);
}

export function parseProposeOutput(raw: unknown): ProposeOutput {
	return parseStageOutput(ProposeOutputSchema, raw);
}

function parseStageOutput<TSchema extends z.ZodType>(
	schema: TSchema,
	raw: unknown,
): z.output<TSchema> {
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		throw new StageError(
			'invalid_model_output',
			`Provider stage output failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown issue'}.`,
		);
	}
	return parsed.data;
}
