// Owner edits to a draft package's cost and date. Only exact catalog values
// allow the preview later; every changed field invalidates any prepared
// preview and is recorded in the package's edited-fields audit trail.
import {
	ShimaPackagePatchRequestSchema,
	patchReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { StaleArtifactError, StaleSessionError, StoreLookupError } from '~~/server/store/errors';
import { commitShima, readShimaView } from '~~/server/store/repository';
import {
	notFound,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StoredPackageSchema } from '~~/server/shima/storage';
import { assertFixtureSession } from '~~/server/shima/publication';
import { defineEventHandler } from 'h3';
import { packageProjection } from '~~/server/shima/packages';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const key = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const packageId = requireParam(event, 'packageId');
		const body = await parseJsonBody(event, ShimaPackagePatchRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);
		const preflight = await readShimaView(key);
		if (!preflight.session) {
			throw notFound('Unknown client or session.');
		}

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
				if (current.section.rev !== body.baseRev) {
					throw new StaleSessionError(
						'Session changed before the write; reload and retry.',
						current.section.rev,
					);
				}
				const stored = current.section.packages[packageId];
				if (!stored) {
					throw new StoreLookupError(`Unknown package '${packageId}'.`);
				}
				if (stored.package.state === 'published') {
					throw new StaleArtifactError('The package is already published.');
				}
				const result = {
					rev: current.section.rev,
					package: packageProjection(session, current.keys, stored),
				};
				const draft = stored.package.draft;
				const fields = body.fields;
				const edited = [...stored.editedFields];
				const nextDraft = { ...draft };
				let changed = false;
				if (
					fields.proposedBudgetYen !== undefined
					&& fields.proposedBudgetYen !== draft.proposedBudgetYen
				) {
					nextDraft.proposedBudgetYen = fields.proposedBudgetYen;
					if (!edited.includes('proposedBudgetYen')) {
						edited.push('proposedBudgetYen');
					}
					changed = true;
				}
				if (
					fields.targetDate !== undefined
					&& fields.targetDate !== draft.targetDate
				) {
					nextDraft.targetDate = fields.targetDate;
					if (!edited.includes('targetDate')) {
						edited.push('targetDate');
					}
					changed = true;
				}
				if (!changed) {
					return { section: current.section, changed: false, result };
				}
				const nextPackage = StoredPackageSchema.parse({
					...stored,
					package: { ...stored.package, draft: nextDraft, previewId: null },
					editedFields: edited,
				});
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					packages: { ...current.section.packages, [packageId]: nextPackage },
				};
				return {
					section,
					result: {
						rev: section.rev,
						package: packageProjection(session, current.keys, nextPackage),
					},
				};
			},
			{
				receipt: {
					route: `shima-package-patch:${packageId}`,
					key: idempotencyKey,
					fingerprint: patchReceiptFingerprint(body),
				},
			},
		);
		const response = outcome.committed
			? outcome.result
			: outcome.replayedResponse;
		return response as Record<string, unknown>;
	}),
);
