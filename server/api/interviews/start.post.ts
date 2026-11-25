// POST /api/interviews/start — consent gate, mode gating, one interview.
// Approved override: one submitted interview/report per owner, so starting
// after submission is rejected (409 already_submitted). Live mode starts the
// embedded-agent interview: it snapshots the profile-derived business intake
// and report language, supersedes pending research of abandoned live
// interviews and queues the profile-intake research pass when the research
// stack is configured (an unconfigured stack degrades to an honest idle
// state, not an error).
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import {
	findActiveUnexpiredInterview,
	findCurrentSubmittedInterview,
	findInterviewById,
	insertInterview,
	insertLiveInterview,
	queueInterviewResearch,
	supersedePendingInterviewResearch,
	toInterviewCurrent,
} from '../../model/interviews';
import { isoPlusMs, nowIso, nowMs } from '../../utils/clock';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { inTransaction } from '../../utils/db';

import { newId } from '../../utils/ids';
import { requireOneOf } from '../../utils/validate';
import { requireOwner } from '../../utils/session';
import { agentConfigured, voiceConfigured } from '../../voice/config';
import { VOICE_RESEARCH_TIMEOUT_MS } from '../../voice/jobs';

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
	if (mode === 'live' && !agentConfigured()) {
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
	if (mode === 'live') {
		const businessName = user.profile.businessName.trim();
		const municipality = user.profile.municipality.trim();
		if (!businessName || !municipality) {
			throw apiError(
				400,
				'validation',
				'Owner profile is missing business details',
			);
		}
		const business = { businessName, location: municipality };
		inTransaction((db) => {
			insertLiveInterview(db, {
				id,
				ownerId: user.id,
				startedAt,
				deadlineAt,
				business,
				reportLanguage: user.profile.locale,
			});
			// Abandoned live interviews must not keep polling research forever.
			supersedePendingInterviewResearch(db, user.id, id);
		});
		if (voiceConfigured()) {
			queueInterviewResearch(
				id,
				business,
				nowMs() + VOICE_RESEARCH_TIMEOUT_MS,
			);
		}
	} else {
		inTransaction((db) => {
			insertInterview(db, {
				id,
				ownerId: user.id,
				mode,
				startedAt,
				deadlineAt,
			});
		});
	}
	const row = findInterviewById(id);
	if (!row) {
		throw apiError(500, 'server_error', 'Interview could not be started');
	}
	return sendJson(event, 201, { interview: toInterviewCurrent(row) });
});
