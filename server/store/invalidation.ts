// Session staleness semantics for storage writes: mutations call the analysis
// seam's pure `computeInvalidation` helper to decide what went stale, and a
// correction additionally stales discovery even though no source row changed.
// The discovery refresh (analyze route) re-derives per-proposal staleness via
// the seam's `refreshProposalStaleness`.
import type { Session } from '../../shared/p0/types';
import { computeInvalidation } from '../analysis';

export function applyInvalidation(
	previous: Session,
	next: Session,
	forceDiscoveryStale = false,
): Session {
	const invalidation = computeInvalidation(previous, next);
	const discoveryStale = invalidation.discoveryStale || forceDiscoveryStale;
	const staleProposalIds = new Set(invalidation.staleProposalIds);
	return {
		...next,
		discovery:
			next.discovery && discoveryStale
				? { ...next.discovery, stale: true }
				: next.discovery,
		proposals: next.proposals.map((proposal) =>
			staleProposalIds.has(proposal.opportunityId)
				? { ...proposal, stale: true }
				: proposal,
		),
	};
}

/**
 * Whether two sessions carry the same semantic content — used to skip the
 * commit (and the revision bump) when a write turns out to be a no-op.
 */
export function sameSession(left: Session, right: Session): boolean {
	return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested: unknown) => {
		if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
			return Object.fromEntries(
				Object.entries(nested as Record<string, unknown>).sort(
					([left], [right]) => left.localeCompare(right),
				),
			);
		}
		return nested;
	});
}
