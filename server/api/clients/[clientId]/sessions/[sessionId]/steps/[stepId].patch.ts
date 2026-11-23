// PATCH …/sessions/:sessionId/steps/:stepId — consultant correction of step
// claims (no graph topology edits). `verify: true` records the submitted fields
// as consultant-verified; otherwise they persist as unverified corrections.
// A correction stales discovery and the proposals whose basis includes the graph.
import { type CorrectionFields, applyStepCorrection } from '~~/server/store/corrections';
import {
	StepPatchRequestSchema,
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
		const body = await parseJsonBody(event, StepPatchRequestSchema);
		const stepId = requireParam(event, 'stepId');
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			body.baseRev,
			(current) => {
				const previous = current.session.workflow.steps.find(
					(step) => step.id === stepId,
				);
				if (!previous) {
					throw new StoreLookupError(
						`Unknown step '${stepId}' for this session.`,
					);
				}
				const corrected = applyStepCorrection(
					previous,
					body.fields as CorrectionFields,
					body.verify,
					buildSourceIndex(current.session),
				);
				const steps = current.session.workflow.steps.map((step) =>
					step.id === stepId ? corrected : step,
				);
				return {
					session: {
						...current.session,
						workflow: { ...current.session.workflow, steps },
					},
				};
			},
			{ forceDiscoveryStale: true },
		);
	}),
);
