// POST /api/interviews/start — consent gate, mode gating, one interview.
// Approved override: one submitted interview/report per owner, so starting
// after submission is rejected (409 already_submitted).
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import {
	findActiveUnexpiredInterview,
	findCurrentSubmittedInterview,
	insertInterview,
	toInterviewCurrent,
} from '../../model/interviews';
import { isoPlusMs, nowIso } from '../../utils/clock';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { inTransaction } from '../../utils/db';

import { newId } from '../../utils/ids';
import { requireOneOf } from '../../utils/validate';
import { requireOwner } from '../../utils/session';

const HOUR_MS = 60 * 60 * 1000;

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const body = await parseJsonBody(event);
	if (body.consent !== true) {
		throw apiError(
			400,
			'validation',
			"Field 'consent' must be exactly the boolean true",
		);
	}
	const mode = requireOneOf(body, 'mode', ['demo', 'live']);
	if (mode === 'live') {
		throw apiError(409, 'mode_unavailable', 'Live mode is not configured');
	}
	if (findCurrentSubmittedInterview(user.id)) {
		throw apiError(
			409,
			'already_submitted',
			'A submitted interview and report already exist',
		);
	}
	if (findActiveUnexpiredInterview(user.id, nowIso())) {
		throw apiError(
			409,
			'interview_active',
			'An unexpired active interview already exists',
		);
	}
	const id = newId();
	const startedAt = nowIso();
	const deadlineAt = isoPlusMs(startedAt, HOUR_MS);
	inTransaction((db) => {
		insertInterview(db, {
			id,
			ownerId: user.id,
			mode,
			startedAt,
			deadlineAt,
		});
	});
	return sendJson(event, 201, {
		interview: toInterviewCurrent({
			id,
			owner_id: user.id,
			mode,
			status: 'active',
			consent_at: startedAt,
			started_at: startedAt,
			deadline_at: deadlineAt,
			submitted_at: null,
			transcript: null,
			created_at: startedAt,
		}),
	});
});
