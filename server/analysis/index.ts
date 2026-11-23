// Analysis seam (stable): provider factory, discovery, proposals, markdown
// rendering, artifact keys, and the pure invalidation helper. Analysis owns
// stage schemas, input projection, and reconciliation — never the store or Nitro.
export { createLiveProvider, type LiveProviderConfig } from './provider-live';
export { discover, type DiscoveryResult } from './discover';
export { propose, type ProposalResult } from './propose';
export { renderPlanMarkdown } from './markdown';
export { runKey } from './keys';
export { computeInvalidation, type Invalidation } from './invalidate';
export { refreshProposalStaleness, isProposalExportBlocked } from './staleness';
export { rankOpportunities, opportunityScore } from './ranking';
export type { AnalysisProvider } from './provider';
export { StageError } from '../../shared/p0/stages';
