// POST /api/snow/drafts — owner only: drafts one snow-day message per guest
// arriving today or tomorrow, in the guest's language.
//   mode 'jma'      — only while JMA has a snow warning/advisory in force for
//                     the inn's municipality (409 no_snow_warning otherwise).
//   mode 'simulate' — demo: acts as if a heavy snow warning were in force,
//                     so the demo never depends on the real weather. The
//                     drafts are marked trigger 'simulated'.
// Nothing is sent here: every draft waits for the owner's approval.
import { SIMULATED_KIND, checkSnow } from '../../snow/jma';
import { createSnowDrafts, innDate } from '../../snow/model';
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import { innInfo, snowPage } from '../../snow/view';
import { nowIso, nowMs } from '../../utils/clock';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { requireOneOf } from '../../utils/validate';
import { requireOwner } from '../../utils/session';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const body = await parseJsonBody(event);
	const mode = requireOneOf(body, 'mode', ['jma', 'simulate'] as const);
	const now = nowMs();
	let warningCode = SIMULATED_KIND.code;
	if (mode === 'jma') {
		const check = await checkSnow(user.profile.municipality, now);
		const strongest = check.status === 'ok' ? check.active[0] : undefined;
		if (!strongest) {
			throw apiError(
				409,
				'no_snow_warning',
				'No snow warning is in force for this area',
			);
		}
		warningCode = strongest.code;
	}
	const created = createSnowDrafts(
		user.id,
		innInfo(user.profile),
		innDate(now),
		innDate(now, 1),
		mode === 'jma' ? 'jma' : 'simulated',
		warningCode,
		nowIso(),
	);
	return sendJson(event, 200, { created, ...(await snowPage(user, now)) });
});
