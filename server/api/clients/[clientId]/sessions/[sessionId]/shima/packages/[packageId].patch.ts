// Owner edits to a draft package's cost and date. Only exact catalog values
// allow the preview later; every changed field invalidates any prepared
// preview and is recorded in the package's edited-fields audit trail.
import {
	ShimaPackagePatchRequestSchema,
	patchReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { checkShimaRev, fixtureSession, projectShimaResult, removePackagePreviews, storedPackage } from '~~/server/shima/owner';
import {
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StaleArtifactError } from '~~/server/store/errors';
import { StoredPackageSchema } from '~~/server/shima/storage';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const key = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const packageId = requireParam(event, 'packageId');
		const body = await parseJsonBody(event, ShimaPackagePatchRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);
		const outcome = await commitShima(
			key,
			(current) => {
				fixtureSession(current);
				checkShimaRev(current, body.baseRev);
				const stored = storedPackage(current, packageId);
				if (stored.package.state === 'published') {
					throw new StaleArtifactError('The package is already published.');
				}
				const result = { kind: 'package', packageId } as const;
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
				if (!changed && stored.package.ownerDecision == null && stored.package.previewId === null) {
					return { section: current.section, result };
				}
				const nextPackage = StoredPackageSchema.parse({
					...stored,
					package: { ...stored.package, draft: nextDraft, previewId: null, ownerDecision: null, decision: null },
					editedFields: edited,
				});
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					packages: { ...current.section.packages, [packageId]: nextPackage },
					previews: removePackagePreviews(current, packageId),
				};
				return {
					section,
					result,
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
		return projectShimaResult(outcome);
	}),
);
