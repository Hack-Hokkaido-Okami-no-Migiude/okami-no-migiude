// Proposal staleness across a discovery refresh: a proposal is re-enabled only
// when it was generated from exactly the basis that exists now. The stored
// generation fingerprint (the propose run key committed with the proposal in
// `record.keys.proposals`) is compared against a fresh key computed from the
// refreshed session, so a proposal stays stale whenever its basis changed at
// any point after generation — including edits made between the proposal and
// the refresh, which a pre/post comparison alone would miss. An absent stored
// fingerprint or a changed provider identity fails closed to stale. While
// discovery is stale the routes block export/approval for every dependent
// proposal regardless of this per-proposal result — use
// `isProposalExportBlocked` for that gate.
import type { Id, Proposal, Session } from '../../shared/p0/types';
import type { AnalysisProvider } from './provider';
import { runKey } from './keys';

export function refreshProposalStaleness(
	next: Session,
	provider: AnalysisProvider,
	generationKeys: Record<Id, string>,
): Proposal[] {
	const refreshedOpportunityIds = new Set(
		next.opportunities.map((opportunity) => opportunity.id),
	);
	const refreshed: Proposal[] = [];
	for (const proposal of next.proposals) {
		// A proposal whose opportunity vanished cannot persist (the session
		// schema requires its opportunity); discovery already notices the loss.
		if (!refreshedOpportunityIds.has(proposal.opportunityId)) {
			continue;
		}
		const generationKey = generationKeys[proposal.opportunityId];
		const stale =
			generationKey === undefined
			|| generationKey
				!== runKey(next, 'propose', provider, proposal.opportunityId);
		refreshed.push({ ...proposal, stale });
	}
	return refreshed;
}

/**
 * The export/approval gate for one proposal: blocked while the proposal itself
 * is stale, and — per the contract — for every dependent proposal while
 * discovery is stale, even before per-proposal staleness is recomputed.
 */
export function isProposalExportBlocked(
	session: Session,
	proposal: Proposal,
): boolean {
	return (
		proposal.stale || session.discovery === null || session.discovery.stale
	);
}
