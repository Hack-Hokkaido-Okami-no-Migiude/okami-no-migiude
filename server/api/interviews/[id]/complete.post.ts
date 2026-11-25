// POST /api/interviews/:id/complete — transcript submit. Idempotent on
// repeats (approved override): a repeat call returns the existing result.
import { defineApi, parseJsonBody, sendJson } from '../../../utils/api';
import {
	findInterviewById,
	toInterviewCurrent,
} from '../../../model/interviews';
import { findReportByInterviewId, insertReport } from '../../../model/reports';
import { apiError } from '../../../utils/errors';
import { assertSameOrigin } from '../../../utils/origin';
import { getRouterParam } from 'h3';
import { inTransaction } from '../../../utils/db';
import { newId } from '../../../utils/ids';
import { nowIso } from '../../../utils/clock';
import { requireOwner } from '../../../utils/session';
import { requireString } from '../../../utils/validate';

const TRANSCRIPT_MAX = 200_000;

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const body = await parseJsonBody(event, 6 * TRANSCRIPT_MAX + 1024);
	const transcript = requireString(body, 'transcript').trim();
	if (transcript.length === 0 || transcript.length > TRANSCRIPT_MAX) {
		throw apiError(
			400,
			'validation',
			'Field transcript must be 1 to 200000 characters after trimming',
		);
	}
	const interview = findInterviewById(getParamId(event));
	if (!interview || interview.owner_id !== user.id) {
		throw apiError(404, 'not_found', 'Interview not found');
	}
	if (interview.status === 'submitted') {
		const existing = findReportByInterviewId(interview.id);
		return sendJson(event, 200, {
			interview: toInterviewCurrent(interview),
			reportId: existing?.id ?? null,
		});
	}
	const submittedAt = nowIso();
	if (interview.deadline_at <= submittedAt) {
		throw apiError(
			409,
			'interview_expired',
			'The interview deadline has passed',
		);
	}
	const reportId = newId();
	inTransaction((db) => {
		const changed = db
			.prepare(
				"UPDATE interviews SET status = 'submitted', submitted_at = ?, transcript = ? WHERE id = ? AND status = 'active' AND deadline_at > ?",
			)
			.run(submittedAt, transcript, interview.id, submittedAt);
		if (Number(changed.changes) === 0) {
			throw apiError(
				409,
				'already_submitted',
				'Interview already completed',
			);
		}
		insertReport(db, {
			id: reportId,
			interviewId: interview.id,
			ownerId: user.id,
			businessName: user.profile.businessName,
			locale: user.profile.locale,
			generator: 'rule_based',
			createdAt: submittedAt,
		});
	});
	return sendJson(event, 200, {
		interview: toInterviewCurrent({
			...interview,
			status: 'submitted',
			submitted_at: submittedAt,
			transcript,
		}),
		reportId,
	});
});

function getParamId(event: import('h3').H3Event): string {
	return getRouterParam(event, 'id') ?? '';
}
