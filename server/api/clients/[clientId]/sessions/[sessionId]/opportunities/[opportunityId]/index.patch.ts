// PATCH …/sessions/:sessionId/opportunities/:opportunityId — consultant edit of
// the savings assumptions. Supplied assumptions replace the stored ones, the
// edited flag is set, and the server recomputes the savings estimate. The edit
// stales only this opportunity's proposal — discovery stays fresh.
import {
	type AssumptionPatch,
	applyAssumptionEdit,
} from '~~/server/store/assumptions';
import {
	OpportunityPatchRequestSchema,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StoreLookupError } from '~~/server/store/errors';
import { buildSourceIndex } from '~~/server/store/sources';
import { commitSessionMutation } from '~~/server/store/commit-session';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, OpportunityPatchRequestSchema);
		const opportunityId = requireParam(event, 'opportunityId');
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			body.baseRev,
			(current) => {
				const previous = current.session.opportunities.find(
					(opportunity) => opportunity.id === opportunityId,
				);
				if (!previous) {
					throw new StoreLookupError(
						`Unknown opportunity '${opportunityId}' for this session.`,
					);
				}
				const updated = applyAssumptionEdit(
					previous,
					body.assumptions as AssumptionPatch,
					buildSourceIndex(current.session),
				);
				const opportunities = current.session.opportunities.map(
					(opportunity) =>
						opportunity.id === opportunityId ? updated : opportunity,
				);
				return { session: { ...current.session, opportunities } };
			},
		);
	}),
);
