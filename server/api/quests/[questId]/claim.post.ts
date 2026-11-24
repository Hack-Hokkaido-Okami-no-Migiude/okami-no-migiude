// Claim a published quest: single-winner by compare-and-swap on the quest
// revision, restricted to same-origin requests from a browser that holds the
// demo-engineer cookie. The engineer is recorded only as a key digest.
import {
	ShimaClaimRequestSchema,
	receiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { assertFixtureClaimOrigin, engineerCookie, publicQuestId } from '~~/server/shima/board';
import {
	httpError,
	invalidInput,
	notFound,
	readJsonBody,
	runRoute,
	staleRevision,
	validateBody,
} from '~~/server/utils/http';
import { commitQuestClaim } from '~~/server/store/repository';
import { createHash } from 'node:crypto';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		assertFixtureClaimOrigin(event);
		const engineerKey = engineerCookie(event);
		if (!engineerKey) {
			throw invalidInput();
		}
		const questId = publicQuestId(event);
		const idempotencyKey = requireIdempotencyKey(event);
		const body = validateBody(await readJsonBody(event, 4096), ShimaClaimRequestSchema);
		const engineerKeyDigest = createHash('sha256')
			.update(engineerKey, 'utf8')
			.digest('hex');

		const outcome = await commitQuestClaim({
			questId,
			baseRev: body.baseRev,
			engineerKeyDigest,
			receipt: { key: idempotencyKey, fingerprint: receiptFingerprint(body) },

		});
		switch (outcome.kind) {
			case 'missing':
				throw notFound();
			case 'conflict':
				if (outcome.reason === 'stale-revision') {
					throw staleRevision(
						'The quest changed before the claim; reload and retry.',
						outcome.currentRev,
					);
				}
				if (outcome.reason === 'already-claimed') {
					throw httpError(
						409,
						'already_claimed',
						'The quest has already been claimed by another engineer.',
					);
				}
				throw httpError(
					409,
					'idempotency_conflict',
					'The claim idempotency key was already used with different input.',
				);
			case 'claimed':
				return outcome.result;
		}
	}, 'public-quest'),
);
