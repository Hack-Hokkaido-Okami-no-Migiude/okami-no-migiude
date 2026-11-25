// GET /api/voice/sessions/current — the owner's latest voice chat, scoped to
// their own rows. The transcript is the owner's own words; staff access to
// voice sessions is not part of this slice.
import { defineApi, sendJson } from '../../../utils/api';
import { requireOwner } from '../../../utils/session';
import {
	findLatestVoiceSessionByOwner,
	parseVoiceBusiness,
	parseVoiceCases,
	type VoiceSessionRow,
} from '../../../voice/model';
import type {
	VoiceAssessmentStatus,
	VoiceResearchStatus,
	VoiceSessionStatus,
} from '#shared/types/voice';

export default defineApi(async (event) => {
	const user = requireOwner(event);
	const row = findLatestVoiceSessionByOwner(user.id);
	if (!row) {
		return sendJson(event, 200, { session: null });
	}
	return sendJson(event, 200, { session: toVoiceSessionStatus(row) });
});

export function toVoiceSessionStatus(row: VoiceSessionRow): VoiceSessionStatus {
	return {
		conversationId: row.conversation_id,
		createdAt: row.created_at,
		reportLanguage: row.report_language,
		research: {
			status: row.research_status as VoiceResearchStatus,
			started: Boolean(row.research_task_id),
			business: parseVoiceBusiness(row.business),
			cases: parseVoiceCases(
				row.research_cases,
			) as VoiceSessionStatus['research']['cases'],
		},
		transcriptRecorded: row.transcript !== null,
		transcript: row.transcript,
		assessment: {
			status: row.assessment_status as VoiceAssessmentStatus,
			reportId: row.assessment_report_id,
		},
	};
}
