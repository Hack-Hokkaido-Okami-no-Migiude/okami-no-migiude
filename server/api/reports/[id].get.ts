// GET /api/reports/:id — owner (own) or any staff; other owners get 404.
import { defineApi, sendJson } from '../../utils/api';
import { findReportById, toReport } from '../../model/reports';
import { apiError } from '../../utils/errors';
import { getRouterParam } from 'h3';
import { requireUser } from '../../utils/session';

export default defineApi(async (event) => {
	const user = requireUser(event);
	const report = findReportById(getRouterParam(event, 'id') ?? '');
	if (!report || (user.role === 'owner' && report.owner_id !== user.id)) {
		throw apiError(404, 'not_found', 'Report not found');
	}
	return sendJson(event, 200, { report: toReport(report) });
});
