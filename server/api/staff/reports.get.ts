// GET /api/staff/reports — staff only; all reports, newest first.
import { defineApi, sendJson } from '../../utils/api';
import type { ReportRow } from '../../model/reports';
import type { StaffReportSummary } from '#shared/types/domain';
import { listStaffReportSummaries } from '../../model/reports';
import { requireStaff } from '../../utils/session';

type SummaryRow = ReportRow & { owner_email: string; owner_name: string };

export function toSummary(row: SummaryRow): StaffReportSummary {
	return {
		id: row.id,
		ownerId: row.owner_id,
		ownerName: row.owner_name,
		ownerEmail: row.owner_email,
		businessName: row.business_name,
		locale: row.locale,
		status: row.status,
		consultationRequestedAt: row.consultation_requested_at,
		createdAt: row.created_at,
	};
}

export default defineApi(async (event) => {
	requireStaff(event);
	const rows = listStaffReportSummaries() as unknown as SummaryRow[];
	return sendJson(event, 200, { reports: rows.map(toSummary) });
});
