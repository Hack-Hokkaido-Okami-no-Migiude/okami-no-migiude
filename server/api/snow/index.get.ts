// GET /api/snow — owner only: today's and tomorrow's arrivals, their
// snow-day messages, and the JMA snow warnings for the inn's municipality.
import { defineApi, sendJson } from '../../utils/api';
import { nowMs } from '../../utils/clock';
import { requireOwner } from '../../utils/session';
import { snowPage } from '../../snow/view';

export default defineApi(async (event) => {
	const user = requireOwner(event);
	return sendJson(event, 200, await snowPage(user, nowMs()));
});
