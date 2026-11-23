// POST /api/clients/:clientId/sessions — create an empty user session (201).
import {
	SessionCreateRequestSchema,
	httpError,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { createSession, readClient } from '~~/server/store/repository';
import { defineEventHandler, setResponseStatus } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const clientId = requireParam(event, 'clientId');
		const body = await parseJsonBody(event, SessionCreateRequestSchema);
		if (!(await readClient(clientId))) {
			throw httpError(404, 'not_found', 'Unknown client.');
		}
		const session = await createSession(clientId, body.title);
		setResponseStatus(event, 201);
		return session;
	}),
);
