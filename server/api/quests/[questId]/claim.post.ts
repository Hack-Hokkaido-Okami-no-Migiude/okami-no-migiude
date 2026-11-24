// Claim a published quest: single-winner by compare-and-swap on the quest
// revision, restricted to same-origin requests from a browser that holds the
// demo-engineer cookie. The engineer is recorded only as a key digest.
import {
	ShimaClaimRequestSchema,
	receiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import { defineEventHandler, getHeader } from 'h3';
import {
	httpError,
	notFound,
	parseJsonBody,
	requireParam,
	runRoute,
	staleRevision,
} from '~~/server/utils/http';
import type { H3Event } from 'h3';
import { commitQuestClaim } from '~~/server/store/repository';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const questId = requireParam(event, 'questId');
		const body = await parseJsonBody(event, ShimaClaimRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);
		assertSameOrigin(event);
		const cookie = getHeader(event, 'cookie') ?? '';
		const match = /(?:^|;\s*)shima_engineer=([^;]+)/.exec(cookie);
		const engineerKey = match?.[1] ?? '';
		if (!z.string().uuid().safeParse(engineerKey).success) {
			throw httpError(
				400,
				'invalid_input',
				'A demo engineer cookie is required to claim a quest.',
			);
		}
		const engineerKeyDigest = createHash('sha256')
			.update(engineerKey, 'utf8')
			.digest('hex');

		const outcome = await commitQuestClaim({
			questId,
			baseRev: body.baseRev,
			engineerKeyDigest,
			receipt: { key: idempotencyKey, fingerprint: receiptFingerprint(body) },
			buildResponse: (quest) => ({
				id: quest.id,
				rev: quest.rev,
				state: quest.state,
			}),
		});
		switch (outcome.kind) {
			case 'replayed':
				return outcome.response as Record<string, unknown>;
			case 'missing':
				throw notFound(`Unknown quest '${questId}'.`);
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
				return {
					id: outcome.quest.id,
					rev: outcome.quest.rev,
					state: outcome.quest.state,
				};
		}
	}),
);

/** Reject claim posts that do not come from the server's own origin. */
function assertSameOrigin(event: H3Event): void {
	const host = getHeader(event, 'host');
	const origin = getHeader(event, 'origin');
	if (!host || !origin) {
		throw httpError(
			400,
			'invalid_input',
			'Claim requests must come from the demo origin.',
		);
	}
	const proto = getHeader(event, 'x-forwarded-proto') ?? 'http';
	if (origin !== `${proto}://${host}`) {
		throw httpError(
			400,
			'invalid_input',
			'Cross-origin claim requests are not accepted.',
		);
	}
}
