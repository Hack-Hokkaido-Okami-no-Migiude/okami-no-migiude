// GET /api/clients/:clientId/sessions/:sessionId — the marked slice read route.
import { httpError, requireParam, runRoute } from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { readSession } from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const record = await readSession({
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		});
		if (!record) {
			throw httpError(404, 'not_found', 'Unknown client or session.');
		}
		return record.session;
	}),
);
