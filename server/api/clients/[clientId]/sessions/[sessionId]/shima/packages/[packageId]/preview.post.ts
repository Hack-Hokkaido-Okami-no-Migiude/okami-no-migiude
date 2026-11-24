// Prepare the exact public preview of a package: the catalog task is bound by
// its canonical hash and stored immutably; the draft must already carry the
// exact catalog commitment (yen and date) — nothing is substituted silently.
import {
	ShimaPreviewRequestSchema,
	previewReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { StaleSessionError, StoreLookupError } from '~~/server/store/errors';
import { StoredPackageSchema, StoredPreviewSchema } from '~~/server/shima/storage';
import { assertFixtureSession, resolveFixtureEligibility } from '~~/server/shima/publication';
import { commitShima, readShimaView } from '~~/server/store/repository';
import {
	notFound,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StageError } from '~~/shared/p0/stages';
import { defineEventHandler } from 'h3';
import { draftMatchesCatalog } from '~~/server/shima/packages';
import { newId } from '~~/server/store/ids';
import { publicTaskHash } from '~~/shared/shima/hash';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const key = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const packageId = requireParam(event, 'packageId');
		const body = await parseJsonBody(event, ShimaPreviewRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);
		const preflight = await readShimaView(key);
		if (!preflight.session) {
			throw notFound('Unknown client or session.');
		}

		const outcome = await commitShima(
			key,
			(current) => {
				// Gates run against the same committed snapshot the CAS compares
				// against, so a session that drifted after the pre-read fails
				// closed instead of publishing stale fixture content.
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
				const pkg = current.section.packages[packageId];
				if (!pkg) {
					throw new StoreLookupError(`Unknown package '${packageId}'.`);
				}
				if (pkg.package.previewId) {
					const existing = current.section.previews[pkg.package.previewId];
					if (existing) {
						return {
							section: current.section,
							changed: false,
							result: previewResult(current.section, existing),
						};
					}
				}
				const eligibility = resolveFixtureEligibility(
					session,
					current.keys,
					pkg.package.opportunityId,
				);
				if (!draftMatchesCatalog(pkg.package.draft, eligibility.task)) {
					throw new StageError(
						'fixture_unsupported',
						'The draft does not match the catalog commitment yet.',
					);
				}
				const previewId = newId('prv');
				const row = StoredPreviewSchema.parse({
					preview: {
						id: previewId,
						hash: publicTaskHash(eligibility.task),
						task: eligibility.task,
					},
					packageId,
					basisKey: pkg.package.basisKey,
					catalogVersion: eligibility.catalogVersion,
					createdAt: new Date().toISOString(),
				});
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					previews: { ...current.section.previews, [previewId]: row },
					packages: {
						...current.section.packages,
						[packageId]: StoredPackageSchema.parse({
							...pkg,
							package: { ...pkg.package, previewId },
						}),
					},
				};
				return { section, result: previewResult(section, row) };
			},
			{
				receipt: {
					route: `shima-package-preview:${packageId}`,
					key: idempotencyKey,
					fingerprint: previewReceiptFingerprint(),
				},
			},
		);
		const response = outcome.committed
			? outcome.result
			: outcome.replayedResponse;
		return response as Record<string, unknown>;
	}),
);

function previewResult(section: { rev: number }, row: { preview: { id: string; hash: string; task: unknown } }) {
	return { rev: section.rev, preview: row.preview };
}
