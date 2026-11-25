// POST /api/reports/:id/consultation — owner (own) only, timestamp-only,
// idempotent on repeats (approved override). Staff receive 403.
import { defineApi, sendJson } from '../../../utils/api';
import {
	findReportById,
	setConsultationRequestedAt,
	toReport,
} from '../../../model/reports';
import { apiError } from '../../../utils/errors';
import { assertSameOrigin } from '../../../utils/origin';
import { getRouterParam } from 'h3';
import { nowIso } from '../../../utils/clock';
import { requireOwner } from '../../../utils/session';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const report = findReportById(getParamId(event));
	if (!report || report.owner_id !== user.id) {
		throw apiError(404, 'not_found', 'Report not found');
	}
	if (report.status !== 'ready') {
		throw apiError(409, 'not_ready', 'Report is not ready');
	}
	if (report.consultation_requested_at) {
		return sendJson(event, 200, { report: toReport(report) });
	}
	setConsultationRequestedAt(report.id, nowIso());
	const updated = findReportById(report.id);
	return sendJson(event, 200, {
		report: toReport(updated ?? report),
	});
});

function getParamId(event: import('h3').H3Event): string {
	return getRouterParam(event, 'id') ?? '';
}
