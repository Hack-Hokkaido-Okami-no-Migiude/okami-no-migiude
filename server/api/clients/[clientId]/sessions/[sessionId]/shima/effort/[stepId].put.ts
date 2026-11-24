// The owner's effort gate for the Shima tracer: accepts exactly the documented
// owner-reported datum on the documented step, cited with evidence that binds
// to the persisted follow-up answer, and commits it through the same atomic
// session snapshot that purges dependent rows.
import {
	ShimaEffortPutRequestSchema,
	effortReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import {
	assertFixtureEffortEvidence,
	assertFixtureEffortInput,
} from '~~/server/shima/effort';
import {
	notFound,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StageError } from '~~/shared/p0/stages';
import { StaleSessionError } from '~~/server/store/errors';
import { StoredEffortSchema } from '~~/server/shima/storage';
import { assertFixtureSession } from '~~/server/shima/publication';
import { canonicalJson } from '~~/shared/shima/hash';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';
import { projectShimaResult } from '~~/server/shima/owner';
import { resolveBinding } from '~~/server/demo/hotel';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const key = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const stepId = requireParam(event, 'stepId');
		const body = await parseJsonBody(event, ShimaEffortPutRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);

		const outcome = await commitShima(
			key,
			(current) => {
				// Gates and projections run against the same committed snapshot
				// the CAS compares against, never the stale pre-read view.
				const session = current.session;
				if (!session) {
					throw notFound('Unknown client or session.');
				}
				assertFixtureSession(session);
				const answerId = resolveBinding(session).answer?.id;
				if (!answerId) {
					throw new StageError(
						'fixture_unsupported',
						'The fixture effort requires the documented follow-up answer.',
					);
				}
				const result = { kind: 'effort', stepId } as const;
				// The receipt check inside commitShima precedes this callback, so
				// a replayed key with changed input conflicts before the gate.
				assertFixtureEffortInput(stepId, body.effort);
				assertFixtureEffortEvidence(session, answerId, body.effort);
				if (current.section.rev !== body.baseRev) {
					throw new StaleSessionError(
						'Session changed before the write; reload and retry.',
						current.section.rev,
					);
				}
				const existing = current.section.effort[stepId];
				if (
					existing
					&& canonicalJson(existing.weeklyOccurrences)
						=== canonicalJson(body.effort.weeklyOccurrences)
					&& canonicalJson(existing.minutesPerOccurrence)
						=== canonicalJson(body.effort.minutesPerOccurrence)
				) {
					return {
						section: current.section,
						result,
					};
				}
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					effort: {
						...current.section.effort,
						[stepId]: StoredEffortSchema.parse({
							stepId,
							weeklyOccurrences: body.effort.weeklyOccurrences,
							minutesPerOccurrence: body.effort.minutesPerOccurrence,
							recordedAt: new Date().toISOString(),
						}),
					},
				};
				return { section, result };
			},
			{
				receipt: {
					route: `shima-effort:${stepId}`,
					key: idempotencyKey,
					fingerprint: effortReceiptFingerprint(body),
				},
			},
		);
		return projectShimaResult(outcome);
	}),
);
