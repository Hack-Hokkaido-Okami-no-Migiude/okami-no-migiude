// Background research engine, ported from okami_voice/src/jobs.ts (research
// half). The state machine is parameterized over a row store so the voice
// sessions (existing conversations) and live interviews (mode 'live') share
// one implementation: queued → submitting → polling → completed/failed, with
// the deadline reaping abandoned rows. Async because Linkup I/O happens here;
// the worker tick guards re-entrancy.
import type { VoiceBusiness, VoiceProviders } from './providers';
import { ProviderError } from './providers';
import {
	claimVoiceResearch,
	deferVoicePoll,
	finishVoiceResearch,
	findDueVoiceSession,
	parseVoiceBusiness,
	saveVoiceTask,
	type VoiceSessionRow,
} from './model';

export const VOICE_POLL_INTERVAL_MS = 5_000;
export const VOICE_RESEARCH_TIMEOUT_MS = 10 * 60_000;

/** One due research row, normalized across the voice and interview stores. */
export type ResearchTarget = {
	/** Voice conversation id or interview id. */
	key: string;
	status: 'queued' | 'polling';
	deadline: number | null;
	taskId: string | null;
	business: VoiceBusiness | null;
};

export type ResearchStore = {
	findDue(now: number): ResearchTarget | undefined;
	claim(key: string): void;
	saveTask(key: string, taskId: string, nextPoll: number): void;
	deferPoll(key: string, nextPoll: number): void;
	finish(key: string, cases: string | null): void;
};

function warn(message: string, key: string, error: unknown): void {
	const detail = error instanceof ProviderError ? ` (${error.message})` : '';
	console.warn(`[voice] ${message} for ${key}${detail}`);
}

/**
 * Processes at most one due research row through the given store; true when
 * work was done so the worker loop can continue immediately.
 */
export async function processNextResearch(
	store: ResearchStore,
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	const target = store.findDue(now);
	if (!target) {
		return false;
	}
	await runResearchJob(target, providers, now, pollMs, store);
	return true;
}

/** Advances one due research row by a single step. */
export async function runResearchJob(
	target: ResearchTarget,
	providers: VoiceProviders,
	now: number,
	pollMs: number,
	store: ResearchStore,
): Promise<void> {
	const key = target.key;
	if (!target.deadline || now >= target.deadline) {
		store.finish(key, null);
		return;
	}

	if (target.status === 'queued') {
		store.claim(key);
		let task: string;
		try {
			task = await providers.startResearch(
				target.business ?? {
					businessName: '',
					location: '',
				},
			);
		} catch (error) {
			store.finish(key, null);
			warn('Research submission failed', key, error);
			return;
		}
		store.saveTask(key, task, now + pollMs);
		return;
	}

	let result: Awaited<ReturnType<VoiceProviders['pollResearch']>>;
	try {
		result = await providers.pollResearch(target.taskId ?? '');
	} catch (error) {
		const permanentHttpError =
			error instanceof ProviderError
			&& error.status < 500
			&& error.status !== 408
			&& error.status !== 429;
		if (permanentHttpError) {
			store.finish(key, null);
			warn('Research polling failed', key, error);
		} else {
			store.deferPoll(key, now + pollMs);
		}
		return;
	}
	if (result.status === 'waiting') {
		store.deferPoll(key, now + pollMs);
	}
	if (result.status === 'failed') {
		store.finish(key, null);
	}
	if (result.status === 'completed') {
		store.finish(key, JSON.stringify(result.cases));
	}
}

// ---------------------------------------------------------------------------
// Voice-session store: existing conversations keep their research lifecycle.
// ---------------------------------------------------------------------------

function toVoiceTarget(row: VoiceSessionRow): ResearchTarget {
	return {
		key: row.conversation_id,
		status: row.research_status === 'polling' ? 'polling' : 'queued',
		deadline: row.research_deadline,
		taskId: row.research_task_id,
		business: parseVoiceBusiness(row.business),
	};
}

export const voiceResearchStore: ResearchStore = {
	findDue(now) {
		const row = findDueVoiceSession(now);
		return row ? toVoiceTarget(row) : undefined;
	},
	claim(key) {
		claimVoiceResearch(key);
	},
	saveTask(key, taskId, nextPoll) {
		saveVoiceTask(key, taskId, nextPoll);
	},
	deferPoll(key, nextPoll) {
		deferVoicePoll(key, nextPoll);
	},
	finish(key, cases) {
		finishVoiceResearch(key, cases);
	},
};

/** Voice wrapper kept for the worker and existing callers. */
export async function processNextVoiceResearch(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	return processNextResearch(voiceResearchStore, now, providers, pollMs);
}
