// Canonical artifact keys for idempotent analysis runs. Keys cover ordered source
// rows/revisions, saved answers, and (for proposals) the current graph and the
// opportunity including assumptions — never timestamps, aggregate revs, or outputs.
import type { Id, Session } from '../../shared/p0/types';
import type { AnalysisProvider } from './provider';
import { STAGE_SCHEMA_VERSION } from '../../shared/p0/stages';
import { createHash } from 'node:crypto';

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
