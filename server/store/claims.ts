// Claim construction shared by consultant corrections and the source-change
// cascade. The shared claim schema enforces value/state/evidence coherence;
// these builders keep every store transition consistent with it.
import type {
	EvidenceRef,
	ExecutionClaim,
	FactorClaim,
	StringClaim,
	StringListClaim,
} from '../../shared/p0/types';

/** Any of the claim shapes carried by steps, edges and opportunity factors. */
export type AnyClaim =
	| StringClaim
	| StringListClaim
	| ExecutionClaim
	| FactorClaim;

export const UNVERIFIED_CORRECTION_INFERENCE =
	'Consultant correction, not yet verified.';

type ClaimCore = {
	value: unknown;
	state: 'unknown' | 'consultant-verified' | 'inferred';
	author: 'consultant';
	evidence: EvidenceRef[];
	/** Required by the shared schema on inferred claims; see the builder. */
	inference?: string;
};

function consultantClaimCore(
	value: unknown,
	evidence: readonly EvidenceRef[],
	verify: boolean,
): ClaimCore {
	if (value === null) {
		return {
			value: null,
			state: 'unknown',
			author: 'consultant',
			evidence: [],
		};
	}
	if (verify) {
		return {
			value,
			state: 'consultant-verified',
			author: 'consultant',
			evidence: [...evidence],
		};
	}
	return {
		value,
		state: 'inferred',
		author: 'consultant',
		evidence: [...evidence],
		// The shared claim schema requires a non-blank label on every inferred
		// claim; a stored correction that has not been verified yet is still
		// inferred, so it carries this explicit unverified label.
		inference: UNVERIFIED_CORRECTION_INFERENCE,
	};
}

export function consultantStringClaim(
	value: string | null,
	evidence: readonly EvidenceRef[],
	verify: boolean,
): StringClaim {
	return consultantClaimCore(value, evidence, verify) as StringClaim;
}

export function consultantStringListClaim(
	value: string[] | null,
	evidence: readonly EvidenceRef[],
	verify: boolean,
): StringListClaim {
	return consultantClaimCore(value, evidence, verify) as StringListClaim;
}

export function consultantExecutionClaim(
	value: 'manual' | 'automated' | 'mixed' | null,
	evidence: readonly EvidenceRef[],
	verify: boolean,
): ExecutionClaim {
	return consultantClaimCore(value, evidence, verify) as ExecutionClaim;
}

/**
 * Drop citations that no longer validate from a claim, whatever its author.
 * Stale copies of quoted source text must not persist in any claim.
 *
 * An analysis-authored claim left without a valid citation reverts to unknown.
 * A consultant-authored value is never silently deleted: when its last
 * citation goes, the claim reverts to the consultant unknown form (the schema
 * keeps unsupported values out of evidence-backed data) and the purged value
 * is reported as `lostConsultantValue` so the caller can surface it as a
 * review-only lost-evidence notice for the consultant to re-verify.
 */
export type StrippedClaim<TClaim extends AnyClaim> = {
	claim: TClaim;
	/** The purged consultant-authored value, or null when nothing was lost. */
	lostConsultantValue: string | null;
};

export function stripClaimCitations<TClaim extends AnyClaim>(
	claim: TClaim,
	keep: (ref: EvidenceRef) => boolean,
): StrippedClaim<TClaim> {
	const remaining = claim.evidence.filter(keep);
	if (remaining.length === claim.evidence.length) {
		return { claim, lostConsultantValue: null };
	}
	if (remaining.length > 0) {
		// Enough support remains: the value keeps its state with the surviving
		// references, whatever the author.
		return {
			claim: { ...claim, evidence: remaining } as TClaim,
			lostConsultantValue: null,
		};
	}
	return {
		claim: {
			value: null,
			state: 'unknown',
			author: claim.author,
			evidence: [],
		} as unknown as TClaim,
		lostConsultantValue:
			claim.author === 'consultant' ? describeClaimValue(claim.value) : null,
	};
}

/** Render a purged claim value for a review-only lost-evidence notice. */
export function describeClaimValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((entry) => describeClaimValue(entry)).join(', ');
	}
	return String(value);
}
