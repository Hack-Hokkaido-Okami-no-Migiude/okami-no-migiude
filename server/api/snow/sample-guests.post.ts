// POST /api/snow/sample-guests — owner only: (re)loads the four fictional
// sample guests (two today, two tomorrow, one per language) for the demo.
import { defineApi, sendJson } from '../../utils/api';
import { innDate, loadSampleGuests } from '../../snow/model';
import { nowIso, nowMs } from '../../utils/clock';
import { assertSameOrigin } from '../../utils/origin';
import { requireOwner } from '../../utils/session';
import { snowPage } from '../../snow/view';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const now = nowMs();
	loadSampleGuests(user.id, innDate(now), innDate(now, 1), nowIso());
	return sendJson(event, 200, await snowPage(user, now));
});
