// Publish a package: the owner's exact-yen confirmation and explicit preview
// approval are both required, the preview hash must still match the prepared
// preview, and the eligibility gates re-run fail-closed. Publishing records
// the immutable decision, creates the public quest, and is replayable.
import {
	IdempotencyConflictError,
	StaleArtifactError,
	StaleSessionError,
	StoreInputError,
} from '~~/server/store/errors';
import {
	ShimaPublishRequestSchema,
	publishReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { StoredPackageSchema, StoredQuestSchema } from '~~/server/shima/storage';
import { assertFixtureSession, resolveFixtureEligibility } from '~~/server/shima/publication';
import { commitShima, readShimaReceipt, readShimaView } from '~~/server/store/repository';
import {
	notFound,
	readJsonBody,
	requireParam,
	runRoute,
	staleRevision,
	validateBody,
} from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { newId } from '~~/server/store/ids';
import { packageProjection } from '~~/server/shima/packages';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const clientId = requireParam(event, 'clientId');
		const sessionId = requireParam(event, 'sessionId');
		const packageId = requireParam(event, 'packageId');
		const idempotencyKey = requireIdempotencyKey(event);
		const raw = await readJsonBody(event);
		const route = `shima-package-publish:${packageId}`;

		// Replay detection precedes full body validation: a replay may arrive
		// with only the revision (the caller's copy of the request is gone).
		// A replay whose body still fully validates must match the original
		// domain input, or the key was reused for different work.
		const stored = await readShimaReceipt(
			{ clientId, sessionId },
			route,
			idempotencyKey,
		);
		if (stored) {
			const reparsed = ShimaPublishRequestSchema.safeParse(raw);
			if (
				reparsed.success
				&& stored.fingerprint !== publishReceiptFingerprint(reparsed.data)
			) {
				throw new IdempotencyConflictError(
					'The idempotency key was already used with different input.',
				);
			}
			return stored.response as Record<string, unknown>;
		}

		// Stale/replayed-into states are surfaced before field validation, so a
		// purged or already-published package answers with the contract status
		// even when the retry body is degenerate.
		const preflight = await readShimaView({ clientId, sessionId });
		if (!preflight.session) {
			throw notFound('Unknown client or session.');
		}
		const preStored = preflight.section.packages[packageId];
		if (!preStored) {
			// The package row is gone (e.g. purged): the caller's view is
			// stale, not merely unknown — a retry after reload is required.
			throw staleRevision(
				'Session changed before the write; reload and retry.',
				preflight.section.rev,
			);
		}
		if (preStored.package.state === 'published') {
			throw new StaleArtifactError('The package is already published.');
		}
		const body = validateBody(raw, ShimaPublishRequestSchema);

		const outcome = await commitShima(
			{ clientId, sessionId },
			(current) => {
				// Gates run against the same committed snapshot the CAS compares
				// against; a session that drifted after the pre-read never
				// publishes stale fixture content.
				const session = current.session;
				if (!session) {
					throw notFound('Unknown client or session.');
				}
				assertFixtureSession(session);
				const currentStored = current.section.packages[packageId];
				if (!currentStored) {
					throw new StaleSessionError(
						'Session changed before the write; reload and retry.',
						current.section.rev,
					);
				}
				// An already-published package is a stale artifact whatever the
				// caller's revision: replays never republish.
				if (currentStored.package.state === 'published') {
					throw new StaleArtifactError('The package is already published.');
				}
				if (current.section.rev !== body.baseRev) {
					throw new StaleSessionError(
						'Session changed before the write; reload and retry.',
						current.section.rev,
					);
				}
				if (currentStored.package.previewId !== body.previewId) {
					throw new StaleArtifactError(
						'The preview changed; prepare it again.',
					);
				}
				const preview = current.section.previews[body.previewId];
				if (!preview || preview.preview.hash !== body.previewHash) {
					throw new StaleArtifactError(
						'The preview hash does not match the prepared preview.',
					);
				}
				if (body.confirmedBudgetYen !== preview.preview.task.confirmedBudgetYen) {
					throw new StoreInputError(
						'The confirmed budget must exactly match the preview amount.',
					);
				}
				const eligibility = resolveFixtureEligibility(
					session,
					current.keys,
					currentStored.package.opportunityId,
				);
				const questId = newId('qst');
				const quest = StoredQuestSchema.parse({
					id: questId,
					packageId,
					rev: 1,
					state: 'available',
					task: preview.preview.task,
					catalogVersion: eligibility.catalogVersion,
					source: { clientId, sessionId },
					publishedAt: new Date().toISOString(),
					receipts: {},
				});
				const nextPackage = StoredPackageSchema.parse({
					...currentStored,
					package: {
						...currentStored.package,
						state: 'published',
						questId,
						decision: {
							kind: 'approved',
							confirmedBudgetYen: body.confirmedBudgetYen,
							previewHash: body.previewHash,
							author: { actorId: 'actor_demo_owner', role: 'demo-owner' },
						},
					},
				});
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					packages: { ...current.section.packages, [packageId]: nextPackage },
				};
				return {
					section,
					upsertQuests: [quest],
					result: {
						rev: section.rev,
						package: packageProjection(session, current.keys, nextPackage),
						quest: publicQuestSummary(quest),
					},
				};
			},
			{
				receipt: {
					route,
					key: idempotencyKey,
					fingerprint: publishReceiptFingerprint(body),
				},
			},
		);
		const response = outcome.committed
			? outcome.result
			: outcome.replayedResponse;
		return response as Record<string, unknown>;
	}),
);

/** The quest's own public projection; claims live on the quest record. */
function publicQuestSummary(quest: { id: string; rev: number; state: 'available' | 'claimed'; task: unknown }) {
	return { id: quest.id, rev: quest.rev, state: quest.state, task: quest.task };
}
