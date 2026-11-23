// Canonical artifact keys for idempotent analysis runs. Keys cover ordered source
// rows/revisions, saved answers, consultant-authored overrides (for discovery),
// and (for proposals) the current graph and the opportunity including
// assumptions — never timestamps, aggregate revs, or generated outputs.
import type { Id, Session, Step } from '../../shared/p0/types';
import type { AnalysisProvider } from './provider';
import { STAGE_SCHEMA_VERSION } from '../../shared/p0/stages';
import { createHash } from 'node:crypto';
import { isPreservedClaim } from './claims';

function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function runKey(
	session: Session,
	operation: 'discover' | 'propose',
	provider: AnalysisProvider,
	opportunityId?: Id,
): string {
	const payload = {
		schemaVersion: STAGE_SCHEMA_VERSION,
		operation,
		providerMode: provider.mode,
		providerKey: provider.key,
		clientId: session.clientId,
		sessionId: session.id,
		transcript:
			session.transcript ?
				session.transcript.segments.map((segment) => ({
					id: segment.id,
					sourceRev: segment.sourceRev,
					speaker: segment.speaker,
					text: segment.text,
					startMs: segment.startMs,
					endMs: segment.endMs,
				}))
			:	null,
		answers: session.questions.flatMap((question) =>
			question.answer ?
				[
					{
						questionId: question.id,
						factKey: question.factKey,
						targetStepId: question.targetStepId,
						sourceRev: question.answer.sourceRev,
						text: question.answer.text,
					},
				]
			:	[],
		),
		graph: operation === 'propose' ? session.workflow : undefined,
		overrides:
			operation === 'discover' ?
				consultantOverrides(session.workflow)
			:	undefined,
		opportunity:
			operation === 'propose' ?
				(session.opportunities.find(
					(opportunity) => opportunity.id === opportunityId,
				) ?? null)
			:	undefined,
		opportunityId:
			operation === 'propose' ? (opportunityId ?? null) : undefined,
	};
	return sha256Hex(JSON.stringify(payload));
}

const OVERRIDABLE_CLAIM_FIELDS = [
	'label',
	'role',
	'tool',
	'inputs',
	'outputs',
	'execution',
	'bottleneck',
	'exception',
] as const;

/**
 * Consultant-authored or verified step claims are "relevant overrides": they
 * change what a re-analysis must preserve, so they belong in the discovery key.
 * Analysis-authored claims are regenerated every run and must stay out of the
 * key, or no run after the first could ever be recognized as unchanged.
 */
function consultantOverrides(graph: Session['workflow']): unknown[] {
	const overrides: unknown[] = [];
	for (const step of graph.steps) {
		const claims = OVERRIDABLE_CLAIM_FIELDS.flatMap((field) => {
			const claim = step[field as keyof Step] as Step['label'];
			if (!isPreservedClaim(claim)) {
				return [];
			}
			return [
				{
					field,
					value: claim.value,
					state: claim.state,
					author: claim.author,
					inference: claim.inference ?? null,
					evidence: claim.evidence,
				},
			];
		});
		if (claims.length > 0) {
			overrides.push({ stepId: step.id, claims });
		}
	}
	return overrides;
}
