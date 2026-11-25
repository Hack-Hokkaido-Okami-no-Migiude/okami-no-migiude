// Report export (download) formatting. Kept separate from the analyzer so a
// later worker can add formats (e.g. PDF) without touching API routes.
import type { Report } from '#shared/types/domain';

export type ReportDownload = {
	filename: string;
	contentType: string;
	body: string;
};

export function reportDownload(report: Report): ReportDownload {
	return {
		filename: `report-${report.id}.md`,
		contentType: 'text/markdown; charset=utf-8',
		body: report.content ?? '',
	};
}
