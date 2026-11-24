import { ShimaPublishRequestSchema, publishReceiptFingerprint, requireIdempotencyKey } from '~~/server/shima/requests';
import { StaleArtifactError, StoreInputError } from '~~/server/store/errors';
import { checkShimaRev, fixturePackageEligibility, fixtureSession, projectShimaResult, storedPackage } from '~~/server/shima/owner';
import { parseJsonBody, requireParam, runRoute } from '~~/server/utils/http';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';
import { draftMatchesCatalog } from '~~/server/shima/packages';
import { isActiveFixturePreview } from '~~/server/shima/publication';
import { newId } from '~~/server/store/ids';

export default defineEventHandler((event) => runRoute(event, async () => {
	const key = { clientId: requireParam(event, 'clientId'), sessionId: requireParam(event, 'sessionId') };
	const packageId = requireParam(event, 'packageId');
	const body = await parseJsonBody(event, ShimaPublishRequestSchema);
	const idempotencyKey = requireIdempotencyKey(event);
	return projectShimaResult(await commitShima(key, (view) => {
		const stored = storedPackage(view, packageId);
		fixtureSession(view);
		const pkg = stored.package;
		if (pkg.state === 'published') {
			throw new StaleArtifactError('The package is already published.');
		}
		checkShimaRev(view, body.baseRev);
		const eligibility = fixturePackageEligibility(view, stored);
		if (pkg.ownerDecision !== 'accept') {
			throw new StaleArtifactError('Accept the package before publishing.');
		}
		const preview = pkg.previewId === body.previewId ? view.section.previews[body.previewId] : undefined;
		if (!isActiveFixturePreview(preview, pkg, eligibility) || preview.preview.hash !== body.previewHash
			|| !draftMatchesCatalog(pkg.draft, eligibility.task)) {
			throw new StaleArtifactError('The preview changed; prepare it again.');
		}
		if (body.confirmedBudgetYen !== preview.preview.task.confirmedBudgetYen) {
			throw new StoreInputError('The confirmed budget must exactly match the preview amount.');
		}
		const questId = newId('qst');
		const now = new Date().toISOString();
		return {
			section: {
				...view.section,
				rev: view.section.rev + 1,
				packages: {
					...view.section.packages,
					[packageId]: {
						...stored,
						package: {
							...pkg,
							state: 'published', questId,
							decision: {
								kind: 'approved', confirmedBudgetYen: body.confirmedBudgetYen,
								previewHash: preview.preview.hash, at: now,
								author: { actorId: 'actor_demo_owner', role: 'demo-owner' },
							},
						},
					},
				},
			},
			upsertQuests: [{
				id: questId, packageId, rev: 1, state: 'available', task: preview.preview.task,
				catalogVersion: eligibility.catalogVersion, catalogKey: eligibility.catalogKey, taskHash: preview.preview.hash,
				source: key, publishedAt: now, receipts: {},
			}],
			result: { kind: 'publish', packageId, questId },
		};
	}, { receipt: { route: `shima-package-publish:${packageId}`, key: idempotencyKey, fingerprint: publishReceiptFingerprint(body) } }));
}));
