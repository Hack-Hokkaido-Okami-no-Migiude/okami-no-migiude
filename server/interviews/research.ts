// Live-interview research: wires the shared research engine (server/voice/
// jobs.ts) to the interviews table. Research is queued when the live
// interview starts (profile intake) and its cases surface on the interview
// page and in the Dify assessment evidence.
import {
	claimInterviewResearch,
	deferInterviewResearchPoll,
	findDueInterviewResearch,
	finishInterviewResearch,
	saveInterviewResearchTask,
	type InterviewRow,
} from '../model/interviews';
import { parseVoiceBusiness } from '../voice/model';
import type { VoiceProviders } from '../voice/providers';
import {
	processNextResearch,
	VOICE_POLL_INTERVAL_MS,
	type ResearchStore,
	type ResearchTarget,
} from '../voice/jobs';

function toResearchTarget(row: InterviewRow): ResearchTarget {
	return {
		key: row.id,
		status: row.research_status === 'polling' ? 'polling' : 'queued',
		deadline: row.research_deadline,
		taskId: row.research_task_id,
		business:
			parseVoiceBusiness(row.business_json) ?? {
				businessName: '',
				location: '',
			},
	};
}

export const interviewResearchStore: ResearchStore = {
	findDue(now) {
		const row = findDueInterviewResearch(now);
		return row ? toResearchTarget(row) : undefined;
	},
	claim(key) {
		claimInterviewResearch(key);
	},
	saveTask(key, taskId, nextPoll) {
		saveInterviewResearchTask(key, taskId, nextPoll);
	},
	deferPoll(key, nextPoll) {
		deferInterviewResearchPoll(key, nextPoll);
	},
	finish(key, cases) {
		finishInterviewResearch(key, cases);
	},
};

/** Research engine pass for live interviews, for the worker loop. */
export async function processNextInterviewResearch(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	return processNextResearch(interviewResearchStore, now, providers, pollMs);
}
