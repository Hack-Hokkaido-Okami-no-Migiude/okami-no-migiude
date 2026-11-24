import { ShimaPreviewRequestSchema, previewReceiptFingerprint, requireIdempotencyKey } from '~~/server/shima/requests';
import { checkShimaRev, fixturePackageEligibility, projectShimaResult, removePackagePreviews, storedPackage } from '~~/server/shima/owner';
import { parseJsonBody, requireParam, runRoute } from '~~/server/utils/http';
import { StageError } from '~~/shared/p0/stages';
import { StaleArtifactError } from '~~/server/store/errors';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';
import { draftMatchesCatalog } from '~~/server/shima/packages';
import { isActiveFixturePreview } from '~~/server/shima/publication';
import { newId } from '~~/server/store/ids';
import { publicTaskHash } from '~~/shared/shima/hash';

export default defineEventHandler((event) => runRoute(event, async () => {
	const key = { clientId: requireParam(event, 'clientId'), sessionId: requireParam(event, 'sessionId') };
	const packageId = requireParam(event, 'packageId');
	const body = await parseJsonBody(event, ShimaPreviewRequestSchema);
	const idempotencyKey = requireIdempotencyKey(event);
	return projectShimaResult(await commitShima(key, (view) => {
		checkShimaRev(view, body.baseRev);
		const stored = storedPackage(view, packageId);
		const pkg = stored.package;
		if (pkg.ownerDecision === 'decline') {
			throw new StaleArtifactError('Reshape the declined package before preparing a preview.');
		}
		const eligibility = fixturePackageEligibility(view, stored);
		if (!draftMatchesCatalog(pkg.draft, eligibility.task)) {
			throw new StageError('fixture_unsupported', 'The draft does not match the catalog commitment yet.');
		}
		const previous = pkg.previewId ? view.section.previews[pkg.previewId] : undefined;
		if (isActiveFixturePreview(previous, pkg, eligibility)) {
			return { section: view.section, result: { kind: 'preview', previewId: previous.preview.id } };
		}
		if (pkg.state === 'published') {
			throw new StaleArtifactError('The published preview is unavailable.');
		}
		const previewId = newId('prv');
		return {
			section: {
				...view.section,
				rev: view.section.rev + 1,
				previews: {
					...removePackagePreviews(view, packageId),
					[previewId]: {
						preview: { id: previewId, hash: publicTaskHash(eligibility.task), task: eligibility.task },
						packageId, basisKey: pkg.basisKey, catalogVersion: eligibility.catalogVersion,
						catalogKey: eligibility.catalogKey, createdAt: new Date().toISOString(),
					},
				},
				packages: { ...view.section.packages, [packageId]: { ...stored, package: { ...pkg, previewId } } },
			},
			result: { kind: 'preview', previewId },
		};
	}, { receipt: { route: `shima-package-preview:${packageId}`, key: idempotencyKey, fingerprint: previewReceiptFingerprint() } }));
}));
