// GET …/opportunities/:opportunityId/plan.md — marked slice route: render the
// current plan as a Markdown attachment; stale proposals are blocked from export.
import { defineEventHandler, setResponseHeader } from 'h3';
import { httpError, requireParam, runRoute } from '~~/server/utils/http';
import { readSession } from '~~/server/store/repository';
import { renderPlanMarkdown } from '~~/server/analysis/index';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const sessionKey = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const opportunityId = requireParam(event, 'opportunityId');
		const record = await readSession(sessionKey);
		if (!record) {
			throw httpError(404, 'not_found', 'Unknown client or session.');
		}
		const proposal = record.session.proposals.find(
			(entry) => entry.opportunityId === opportunityId,
		);
		if (!proposal) {
			throw httpError(
				404,
				'not_found',
				'No proposal exists for this opportunity.',
			);
		}
		if (proposal.stale) {
			throw httpError(
				409,
				'stale_artifact',
				'The proposal is stale; refresh discovery and regenerate before exporting.',
			);
		}

		const markdown = renderPlanMarkdown(record.session, proposal);
		setResponseHeader(
			event,
			'content-type',
			'text/markdown; charset=utf-8',
		);
		setResponseHeader(
			event,
			'content-disposition',
			'attachment; filename="implementation-plan.md"',
		);
		return markdown;
	}),
);
