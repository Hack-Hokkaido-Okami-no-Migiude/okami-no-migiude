// GET /api/reports/:id/download — private, non-cacheable markdown attachment.
import { findReportById, toReport } from '../../../model/reports';
import { getRouterParam, setResponseHeader, setResponseStatus } from 'h3';
import { apiError } from '../../../utils/errors';
import { defineApi } from '../../../utils/api';
import { reportDownload } from '../../../export';
import { requireUser } from '../../../utils/session';

export default defineApi(async (event) => {
	const user = requireUser(event);
	const report = findReportById(getRouterParam(event, 'id') ?? '');
	if (!report || (user.role === 'owner' && report.owner_id !== user.id)) {
		throw apiError(404, 'not_found', 'Report not found');
	}
	if (report.status !== 'ready' || report.content === null) {
		throw apiError(409, 'not_ready', 'Report is not ready');
	}
	const download = reportDownload(toReport(report));
	setResponseHeader(event, 'content-type', download.contentType);
	setResponseHeader(
		event,
		'content-disposition',
		`attachment; filename="${download.filename}"`,
	);
	setResponseHeader(event, 'cache-control', 'no-store');
	setResponseStatus(event, 200);
	return download.body;
});
