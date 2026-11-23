// Boundary evidence validation: every `EvidenceRef` accepted at the HTTP
// boundary must point at an active transcript segment or a consultant answer in
// the same session, cite that row's current revision, and quote a verbatim
// substring of the stored original text. Provenance validation establishes
// where a claim came from — it is not factual certification of the claim.
import type { EvidenceRef, Id, Session } from '../../shared/p0/types';
import { StoreInputError } from './errors';

/** Every citable source in one session: transcript segments plus saved answers. */
export type SourceIndex = Map<Id, { sourceRev: number; text: string }>;

export function buildSourceIndex(session: Session): SourceIndex {
	const index: SourceIndex = new Map();
	if (session.transcript) {
		for (const segment of session.transcript.segments) {
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

/** Validate references for a submitted claim; the first failure is reported. */
export function assertEvidenceRefs(
	refs: readonly EvidenceRef[],
	sources: SourceIndex,
): void {
	for (const ref of refs) {
		const source = sources.get(ref.sourceId);
		if (!source) {
			throw new StoreInputError(
				`Evidence cites unknown source '${ref.sourceId}'.`,
			);
		}
		if (source.sourceRev !== ref.sourceRev) {
			throw new StoreInputError(
				`Evidence cites an outdated revision of source '${ref.sourceId}'.`,
			);
		}
		if (!source.text.includes(ref.quote)) {
			throw new StoreInputError(
				`Evidence quote is not a verbatim substring of source '${ref.sourceId}'.`,
			);
		}
	}
}

/** Whether a stored reference still resolves against the given sources. */
export function evidenceRefIsValid(
	ref: EvidenceRef,
	sources: SourceIndex,
): boolean {
	const source = sources.get(ref.sourceId);
	return (
		source !== undefined
		&& source.sourceRev === ref.sourceRev
		&& source.text.includes(ref.quote)
	);
}
