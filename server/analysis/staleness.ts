// Proposal staleness across a discovery refresh: a proposal is re-enabled when
// its relevant pre/post basis (the canonical propose key) is unchanged, and kept
// stale otherwise. While discovery is stale the routes block export/approval for
// every dependent proposal regardless of this per-proposal result.
import type { Proposal, Session } from '../../shared/p0/types';
import type { AnalysisProvider } from './provider';
import { runKey } from './keys';

export function refreshProposalStaleness(
	base: Session,
	next: Omit<Session, 'proposals'> & { proposals?: Proposal[] },
	provider: AnalysisProvider,
): Proposal[] {
	return base.proposals.map((proposal) => ({
		...proposal,
		stale:
			runKey(base, 'propose', provider, proposal.opportunityId)
			!== runKey(
				{ ...next, proposals: base.proposals },
				'propose',
				provider,
				proposal.opportunityId,
			),
	}));
}
