// GET /api/clients/:clientId/sessions — session summaries for one client.
import { httpError, requireParam, runRoute } from '~~/server/utils/http';
import { listSessions, readClient } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const clientId = requireParam(event, 'clientId');
		if (!(await readClient(clientId))) {
			throw httpError(404, 'not_found', 'Unknown client.');
		}
		return listSessions(clientId);
	}),
);
