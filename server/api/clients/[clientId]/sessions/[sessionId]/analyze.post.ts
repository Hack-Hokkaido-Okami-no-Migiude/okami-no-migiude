// POST …/sessions/:sessionId/analyze — marked slice route: run discovery with
// the requested provider mode and commit the validated patch with CAS.
import {
	type SessionRecord,
	casSession,
	readSession,
} from '~~/server/store/repository';
import {
	createLiveProvider,
	discover,
	refreshProposalStaleness,
} from '~~/server/analysis/index';
import {
	httpError,
	parseJsonBody,
	requireParam,
	runRoute,
	singleFlight,
	staleRevision,
} from '~~/server/utils/http';
import { AnalyzeRequestSchema } from '~~/shared/p0/schemas';
import { createHotelFixtureProvider } from '~~/server/demo/hotel';
import { defineEventHandler } from 'h3';
import { runKey } from '~~/server/analysis/keys';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, AnalyzeRequestSchema);
		const sessionKey = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const current = await readSession(sessionKey);
		if (!current) {
			throw httpError(404, 'not_found', 'Unknown client or session.');
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
				'Live analysis sends the current transcript and saved answers to the configured external provider; pass allowExternal:true to consent.',
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
		const artifactKey = runKey(current.session, 'discover', provider);

		return singleFlight(
			`${sessionKey.clientId}:${sessionKey.sessionId}:discover:${body.baseRev}:${artifactKey}`,
			async () => {
				const fresh = await recheckFresh(sessionKey, body.baseRev);
				if (fresh.keys.discovery === artifactKey) {
					return {
						outcome: 'unchanged' as const,
						session: fresh.session,
					};
				}
				const { patch, artifactKey: computedKey } = await discover(
					fresh.session,
					provider,
				);
				const proposals = refreshProposalStaleness(
					fresh.session,
					{ ...fresh.session, ...patch },
					provider,
				);
				const next: SessionRecord = {
					session: { ...fresh.session, ...patch, proposals },
					keys: { ...fresh.keys, discovery: computedKey },
				};
				const committed = await casSession(
					sessionKey,
					fresh.session.rev,
					next,
				);
				if (!committed) {
					const raced = await readSession(sessionKey);
					throw staleRevision(
						'Session changed while analyzing; reload and review before retrying.',
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

/** Reload and re-check the base revision inside the single-flight window. */
async function recheckFresh(
	sessionKey: { clientId: string; sessionId: string },
	baseRev: number,
): Promise<SessionRecord> {
	const fresh = await readSession(sessionKey);
	if (!fresh) {
		throw httpError(
			404,
			'not_found',
			'Session was deleted while analyzing.',
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
