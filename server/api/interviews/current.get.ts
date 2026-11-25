// GET /api/interviews/current — owner only; "current" is the submitted
// interview, else the active unexpired one; expiry is derived from deadlineAt.
import { defineApi, sendJson } from '../../utils/api';
import {
	findActiveUnexpiredInterview,
	findCurrentSubmittedInterview,
	toInterviewCurrent,
} from '../../model/interviews';
import { findReportByInterviewId } from '../../model/reports';
import { nowIso } from '../../utils/clock';
import { requireOwner } from '../../utils/session';

export default defineApi(async (event) => {
	const user = requireOwner(event);
	const submitted = findCurrentSubmittedInterview(user.id);
	if (submitted) {
		const report = findReportByInterviewId(submitted.id);
		return sendJson(event, 200, {
			interview: toInterviewCurrent(submitted),
			reportId: report?.id ?? null,
		});
	}
	const active = findActiveUnexpiredInterview(user.id, nowIso());
	if (active) {
		return sendJson(event, 200, {
			interview: toInterviewCurrent(active),
			reportId: null,
		});
	}
	return sendJson(event, 200, { interview: null, reportId: null });
});
