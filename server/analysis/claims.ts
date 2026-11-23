// Claim construction and preservation rules shared by reconciliation. Analysis
// always authors fresh `inferred` claims from validated provider output and
// keeps unknown claims for absent facts; it never overwrites consultant-authored
// or verified/confirmed claims. That preservation rule is the seam contract's
// "verified fields preserved, consultant edits kept" guarantee.
import type { EvidenceRef } from '../../shared/p0/types';

/** Label recorded on every analysis-authored `inferred` claim. */
export const INFERENCE_LABEL = 'Inferred from the cited interview text.';

/** The minimal claim shape every persisted claim conforms to. */
export type ClaimLike = {
	value: unknown;
	state: 'client-confirmed' | 'inferred' | 'unknown' | 'consultant-verified';
	author: 'analysis' | 'consultant';
	evidence: EvidenceRef[];
	inference?: string;
};

/**
 * A claim analysis must preserve on re-analysis: anything authored by a
 * consultant, or in a verified/confirmed state. Analysis-authored inferred and
 * unknown claims are always recomputed from the current extraction.
 */
export function isPreservedClaim(
	claim: ClaimLike | undefined | null,
): claim is ClaimLike {
	if (!claim) {
		return false;
	}
	return (
		claim.author === 'consultant'
		|| claim.state === 'consultant-verified'
		|| claim.state === 'client-confirmed'
	);
}

/** Return the claim when it must be preserved, otherwise `undefined`. */
export function preservedClaim<TClaim extends ClaimLike>(
	claim: TClaim | undefined | null,
): TClaim | undefined {
	return isPreservedClaim(claim) ? claim : undefined;
}

export type AnalysisClaim<TValue> = {
	value: TValue | null;
	state: 'inferred' | 'unknown';
	author: 'analysis';
	evidence: EvidenceRef[];
	inference?: string;
};

/** Build an evidence-backed inferred claim authored by analysis. */
export function inferredClaim<TValue>(
	value: TValue,
	evidence: EvidenceRef[],
): AnalysisClaim<TValue> & { inference: string } {
	return {
		value,
		state: 'inferred',
		author: 'analysis',
		evidence: evidence.map((reference) => ({ ...reference })),
		inference: INFERENCE_LABEL,
	};
}

/** Build the unknown claim for a fact the current sources do not establish. */
export function unknownClaim<TValue>(): AnalysisClaim<TValue> {
	return { value: null, state: 'unknown', author: 'analysis', evidence: [] };
}
