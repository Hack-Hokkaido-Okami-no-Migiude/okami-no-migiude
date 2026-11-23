// DELETE …/sessions/:sessionId/transcript?baseRev=N — clear the transcript and
// cascade every artifact derived from it: graph, questions and answers,
// opportunities, proposals and plans, the discovery run, and the artifact keys
// (fingerprints). Already-cleared sessions are returned unchanged.
import {
	requireBaseRevQuery,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { commitSessionMutation } from '~~/server/store/commit-session';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const baseRev = requireBaseRevQuery(event);
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			baseRev,
			(current) => {
				if (!current.session.transcript) {
					return { session: null };
				}
				return {
					session: {
						...current.session,
						transcript: null,
						workflow: { steps: [], edges: [] },
						questions: [],
						opportunities: [],
						proposals: [],
						discovery: null,
						reviewNotices: [],
					},
					keys: { discovery: null, proposals: {} },
				};
			},
		);
	}),
);
