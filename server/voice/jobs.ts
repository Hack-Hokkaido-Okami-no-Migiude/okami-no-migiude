// Voice research job, ported from okami_voice/src/jobs.ts (research half
// only — the report generation lives with the later assessment wiring).
// Async because Linkup I/O happens here; the worker tick guards re-entrancy.
import {
	claimVoiceResearch,
	deferVoicePoll,
	finishVoiceResearch,
	findDueVoiceSession,
	parseVoiceBusiness,
	saveVoiceTask,
	type VoiceSessionRow,
} from './model';
import { ProviderError, type VoiceProviders } from './providers';

export const VOICE_POLL_INTERVAL_MS = 5_000;
export const VOICE_RESEARCH_TIMEOUT_MS = 10 * 60_000;

function warn(message: string, conversationId: string, error: unknown): void {
	const detail = error instanceof ProviderError ? ` (${error.message})` : '';
	console.warn(`[voice] ${message} for ${conversationId}${detail}`);
}

/**
 * Processes at most one due voice session; returns whether work was done so
 * the worker loop can continue immediately.
 */
export async function processNextVoiceResearch(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	const session = findDueVoiceSession(now);
	if (!session) {
		return false;
	}
	await runVoiceResearchJob(session, providers, now, pollMs);
	return true;
}

export async function runVoiceResearchJob(
	session: VoiceSessionRow,
	providers: VoiceProviders,
	now: number,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<void> {
	const id = session.conversation_id;
	const { research_status: status, research_deadline: deadline } = session;
	if (status !== 'queued' && status !== 'polling') {
		return;
	}
	if (!deadline || now >= deadline) {
		finishVoiceResearch(id, null);
		return;
	}

	if (status === 'queued') {
		claimVoiceResearch(id);
		let task: string;
		try {
			task = await providers.startResearch(
				parseVoiceBusiness(session.business) ?? {
					businessName: '',
					location: '',
				},
			);
		} catch (error) {
			finishVoiceResearch(id, null);
			warn('Research submission failed', id, error);
			return;
		}
		saveVoiceTask(id, task, now + pollMs);
		return;
	}

	let result: Awaited<ReturnType<VoiceProviders['pollResearch']>>;
	try {
		result = await providers.pollResearch(session.research_task_id ?? '');
	} catch (error) {
		const permanentHttpError =
			error instanceof ProviderError
			&& error.status < 500
			&& error.status !== 408
			&& error.status !== 429;
		if (permanentHttpError) {
			finishVoiceResearch(id, null);
			warn('Research polling failed', id, error);
		} else {
			deferVoicePoll(id, now + pollMs);
		}
		return;
	}
	if (result.status === 'waiting') {
		deferVoicePoll(id, now + pollMs);
	}
	if (result.status === 'failed') {
		finishVoiceResearch(id, null);
	}
	if (result.status === 'completed') {
		finishVoiceResearch(id, JSON.stringify(result.cases));
	}
}
