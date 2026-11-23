// PATCH …/opportunities/:opportunityId/plan — review/edit the proposal's plan.
// Changed section text is tracked as edited (and resets the status to draft
// unless an explicit status is supplied); approving a stale plan — while the
// proposal or its discovery is stale — is rejected.
import { type PlanPatch, applyPlanPatch } from '~~/server/store/plans';
import {
	PlanPatchRequestSchema,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StaleArtifactError, StoreLookupError } from '~~/server/store/errors';
import { commitSessionMutation } from '~~/server/store/commit-session';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, PlanPatchRequestSchema);
		const opportunityId = requireParam(event, 'opportunityId');
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			body.baseRev,
			(current) => {
				const previous = current.session.proposals.find(
					(proposal) => proposal.opportunityId === opportunityId,
				);
				if (!previous) {
					throw new StoreLookupError(
						`No proposal exists for opportunity '${opportunityId}'.`,
					);
				}
				if (
					body.status === 'approved'
					&& (previous.stale || current.session.discovery?.stale)
				) {
					throw new StaleArtifactError(
						'The plan is stale; refresh discovery and regenerate before approving.',
					);
				}
				const patched = applyPlanPatch(previous.plan, {
					sections: body.sections,
					status: body.status,
				} satisfies PlanPatch);
				const proposals = current.session.proposals.map((proposal) =>
					proposal.opportunityId === opportunityId
						? { ...proposal, plan: patched.plan }
						: proposal,
				);
				return { session: { ...current.session, proposals } };
			},
		);
	}),
);
