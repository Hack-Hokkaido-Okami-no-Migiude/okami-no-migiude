import { ShimaDecisionRequestSchema, receiptFingerprint, requireIdempotencyKey } from '~~/server/shima/requests';
import { checkShimaRev, fixturePackageEligibility, fixtureSession, projectShimaResult, removePackagePreviews, storedPackage } from '~~/server/shima/owner';
import { parseJsonBody, requireParam, runRoute } from '~~/server/utils/http';
import { StaleArtifactError } from '~~/server/store/errors';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) => runRoute(event, async () => {
	const key = { clientId: requireParam(event, 'clientId'), sessionId: requireParam(event, 'sessionId') };
	const packageId = requireParam(event, 'packageId');
	const body = await parseJsonBody(event, ShimaDecisionRequestSchema);
	const idempotencyKey = requireIdempotencyKey(event);
	return projectShimaResult(await commitShima(key, (view) => {
		const stored = storedPackage(view, packageId);
		fixtureSession(view);
		checkShimaRev(view, body.baseRev);
		const pkg = stored.package;
		if (pkg.state !== 'draft' || (pkg.ownerDecision === 'decline' && body.decision === 'accept')) {
			throw new StaleArtifactError('The package is not open for that decision.');
		}
		const result = { kind: 'package', packageId } as const;
		if (body.decision === 'accept') {
			fixturePackageEligibility(view, stored);
		}
		if (pkg.ownerDecision === body.decision) {
			return { section: view.section, result };
		}
		const declined = body.decision === 'decline';
		return {
			section: {
				...view.section,
				rev: view.section.rev + 1,
				packages: {
					...view.section.packages,
					[packageId]: { ...stored, package: { ...pkg, ownerDecision: body.decision, decision: null, previewId: declined ? null : pkg.previewId } },
				},
				previews: declined ? removePackagePreviews(view, packageId) : view.section.previews,
			},
			result,
		};
	}, { receipt: { route: `shima-package-decision:${packageId}`, key: idempotencyKey, fingerprint: receiptFingerprint(body) } }));
}));
