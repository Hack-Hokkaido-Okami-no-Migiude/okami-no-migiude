// Live-interview assessment: wires the shared post-call assessment engine
// (server/voice/assessment.ts) to the interviews table. A stored transcript
// queues the Dify assessment; the engine runs the transcript-informed deep
// research pass and writes the Dify report with the interview id attached.
import { enqueueReportReadyMails } from '../mail';
import { newId } from '../utils/ids';
import { inTransaction } from '../utils/db';
import {
	claimInterviewAssessment,
	claimInterviewAssessmentResearch,
	deferInterviewAssessmentPoll,
	failInterviewAssessment,
	findDueInterviewAssessment,
	finishInterviewAssessment,
	finishInterviewAssessmentResearch,
	findInterviewById,
	retryInterviewAssessment,
	saveInterviewAssessmentTask,
	type InterviewRow,
} from '../model/interviews';
import { parseVoiceBusiness } from '../voice/model';
import type { VoiceProviders } from '../voice/providers';
import { VOICE_POLL_INTERVAL_MS } from '../voice/jobs';
import {
	processNextAssessment,
	type AssessmentStore,
	type AssessmentTarget,
} from '../voice/assessment';

function toAssessmentTarget(row: InterviewRow): AssessmentTarget {
	return {
		key: row.id,
		ownerId: row.owner_id,
		status: row.assessment_status === 'running' ? 'running' : 'queued',
		attempts: row.assessment_attempts,
		deadline: row.assessment_deadline,
		researchStatus: row.assessment_research_status,
		researchTaskId: row.assessment_research_task_id,
		researchDeadline: row.assessment_research_deadline,
		researchPollAt: row.assessment_research_poll_at,
		transcript: row.transcript,
		businessJson: row.business_json,
		// Live rows always carry the profile language snapshot; demo rows
		// never reach the engine, so the fallback only guards typing.
		reportLanguage: row.report_language ?? 'ja',
		inCallCasesJson: row.research_cases,
		deepDossierJson: row.assessment_research_cases,
	};
}

export const interviewAssessmentStore: AssessmentStore = {
	findDue(now) {
		const row = findDueInterviewAssessment(now);
		return row ? toAssessmentTarget(row) : undefined;
	},
	revalidate(key) {
		const row = findInterviewById(key);
		return row ? toAssessmentTarget(row) : undefined;
	},
	claim(key, deadline) {
		claimInterviewAssessment(key, deadline);
	},
	retry(key, attempts, after) {
		retryInterviewAssessment(key, attempts, after);
	},
	fail(key, attempts) {
		failInterviewAssessment(key, attempts);
	},
	finish(key, reportId) {
		finishInterviewAssessment(key, reportId);
	},
	claimResearch(key) {
		claimInterviewAssessmentResearch(key);
	},
	saveResearchTask(key, taskId, deadline, nextPoll) {
		saveInterviewAssessmentTask(key, taskId, deadline, nextPoll);
	},
	deferResearchPoll(key, nextPoll) {
		deferInterviewAssessmentPoll(key, nextPoll);
	},
	finishResearch(key, dossier) {
		finishInterviewAssessmentResearch(key, dossier);
	},
	writeReport(target, report, nowIsoText) {
		const reportId = newId();
		// Interview reports are born ready too: the pending/failed report
		// states belong to the demo path; here the interview row's assessment
		// lifecycle owns retries, so the report row records the outcome.
		inTransaction((db) => {
			db.prepare(
				`INSERT INTO reports
					(id, interview_id, voice_conversation_id, owner_id, business_name, locale,
					generator, status, content, failure_reason, consultation_requested_at,
					created_at, ready_at, generate_attempts, generate_after)
				 VALUES (?, ?, NULL, ?, ?, ?, 'dify', 'ready', ?, NULL, NULL, ?, ?, 0, NULL)`,
			).run(
				reportId,
				target.key,
				target.ownerId,
				parseVoiceBusiness(target.businessJson)?.businessName ?? '',
				target.reportLanguage,
				report,
				nowIsoText,
				nowIsoText,
			);
			enqueueReportReadyMails(db, {
				id: reportId,
				business_name:
					parseVoiceBusiness(target.businessJson)?.businessName ?? '',
				locale: target.reportLanguage,
				owner_id: target.ownerId,
			});
		});
		return reportId;
	},
};

/** Assessment engine pass for live interviews, for the worker loop. */
export async function processNextInterviewAssessment(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	return processNextAssessment(
		interviewAssessmentStore,
		now,
		providers,
		pollMs,
	);
}
