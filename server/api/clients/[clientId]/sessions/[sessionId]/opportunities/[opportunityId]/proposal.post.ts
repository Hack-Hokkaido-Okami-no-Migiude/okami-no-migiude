// POST …/opportunities/:opportunityId/proposal — marked slice route: generate a
// separate proposal + draft plan for a persisted opportunity under fresh
// discovery, committed with CAS.
import {
	type SessionRecord,
	casSession,
	readSession,
} from '~~/server/store/repository';
import { createLiveProvider, propose } from '~~/server/analysis/index';
import {
	httpError,
	parseJsonBody,
	requireParam,
	runRoute,
	singleFlight,
	staleRevision,
} from '~~/server/utils/http';
import { ProposalRequestSchema } from '~~/shared/p0/schemas';
import { createHotelFixtureProvider } from '~~/server/demo/hotel';
import { defineEventHandler } from 'h3';
import { runKey } from '~~/server/analysis/keys';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, ProposalRequestSchema);
		const sessionKey = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const opportunityId = requireParam(event, 'opportunityId');
		const current = await readSession(sessionKey);
		if (!current) {
			throw httpError(404, 'not_found', 'Unknown client or session.');
		}
		if (
			!current.session.opportunities.some(
				(opportunity) => opportunity.id === opportunityId,
			)
		) {
			throw httpError(
				404,
				'not_found',
				'Unknown opportunity for this session.',
			);
		}
		if (!current.session.discovery || current.session.discovery.stale) {
			throw httpError(
				409,
				'stale_artifact',
				'Discovery is missing or stale; run analyze again before proposing.',
			);
		}
		if (current.session.rev !== body.baseRev) {
			throw staleRevision(
				'Session changed before the run; reload and retry.',
				current.session.rev,
			);
		}
		if (body.mode === 'live' && body.allowExternal !== true) {
			throw httpError(
				422,
				'consent_required',
				'Live proposal generation sends the current graph and opportunity to the configured external provider; pass allowExternal:true to consent.',
			);
		}

		const provider =
			body.mode === 'fixture' ?
				createHotelFixtureProvider(current.session)
			:	createLiveProvider({
					baseUrl: process.env.NUXT_LLM_BASE_URL ?? '',
					apiKey: process.env.NUXT_LLM_API_KEY ?? '',
					model: process.env.NUXT_LLM_MODEL ?? '',
				});
		const artifactKey = runKey(
			current.session,
			'propose',
			provider,
			opportunityId,
		);

		return singleFlight(
			`${sessionKey.clientId}:${sessionKey.sessionId}:propose:${opportunityId}:${body.baseRev}:${artifactKey}`,
			async () => {
				const fresh = await recheckFresh(
					sessionKey,
					opportunityId,
					body.baseRev,
				);
				if (fresh.keys.proposals[opportunityId] === artifactKey) {
					return {
						outcome: 'unchanged' as const,
						session: fresh.session,
					};
				}
				const { proposal, artifactKey: computedKey } = await propose(
					fresh.session,
					opportunityId,
					provider,
				);
				const proposals = [
					...fresh.session.proposals.filter(
						(entry) => entry.opportunityId !== opportunityId,
					),
					proposal,
				];
				const next: SessionRecord = {
					session: { ...fresh.session, proposals },
					keys: {
						...fresh.keys,
						proposals: {
							...fresh.keys.proposals,
							[opportunityId]: computedKey,
						},
					},
				};
				const committed = await casSession(
					sessionKey,
					fresh.session.rev,
					next,
				);
				if (!committed) {
					const raced = await readSession(sessionKey);
					throw staleRevision(
						'Session changed while proposing; reload and review before retrying.',
						raced?.session.rev ?? fresh.session.rev,
					);
				}
				return {
					outcome: 'updated' as const,
					session: committed.session,
				};
			},
		);
	}),
);

/** Reload and re-check existence plus base revision inside the single-flight window. */
async function recheckFresh(
	sessionKey: { clientId: string; sessionId: string },
	opportunityId: string,
	baseRev: number,
): Promise<SessionRecord> {
	const fresh = await readSession(sessionKey);
	if (!fresh) {
		throw httpError(
			404,
			'not_found',
			'Session was deleted while proposing.',
		);
	}
	if (
		!fresh.session.opportunities.some(
			(opportunity) => opportunity.id === opportunityId,
		)
	) {
		throw httpError(
			404,
			'not_found',
			'Unknown opportunity for this session.',
		);
	}
	if (fresh.session.rev !== baseRev) {
		throw staleRevision(
			'Session changed before the run; reload and retry.',
			fresh.session.rev,
		);
	}
	return fresh;
}
