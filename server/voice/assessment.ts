// Post-call assessment engine, phased across worker ticks: (1) submit a
// second, transcript-informed Linkup deep pass at the heaviest reasoning
// depth — a full sourced dossier, not a case list, (2) poll it exactly like
// the in-call research, (3) write the Dify report from the transcript, the
// business intake and the research evidence (in-call cases plus the deep
// dossier) and mail it. Deep-pass failure is graceful — the report ships
// with the in-call cases; only the Dify write retries.
//
// The state machine is parameterized over a row store so the voice sessions
// (existing conversations) and live interviews (mode 'live') share one
// implementation. State lives on the row itself (same pattern as the
// research job), so a crashed tick resumes or is failed at the deadline.
import { enqueueReportReadyMails } from '../mail';
import { nowIso } from '../utils/clock';
import { newId } from '../utils/ids';
import { TOPICS } from '../analyze/rules';
import { inTransaction } from '../utils/db';
import {
	DEEP_RESEARCH_REASONING_DEPTH,
	DEEP_RESEARCH_TIMEOUT_MS,
	deepResearchPrompt,
} from './deep-research';
import { DIFY_RUN_TIMEOUT_MS } from './dify-stream';
import { VOICE_POLL_INTERVAL_MS } from './jobs';
import {
	claimVoiceAssessment,
	claimAssessmentResearch,
	deferAssessmentPoll,
	failVoiceAssessment,
	findDueVoiceAssessment,
	findVoiceSessionByConversation,
	finishAssessmentResearch,
	finishVoiceAssessment,
	parseVoiceBusiness,
	parseVoiceCases,
	retryVoiceAssessment,
	saveAssessmentTask,
	type VoiceSessionRow,
} from './model';
import {
	ProviderError,
	object,
	type VoiceProviders,
	type VoiceResearchReport,
} from './providers';

export const VOICE_ASSESSMENT_MAX_ATTEMPTS = 5;
export const VOICE_ASSESSMENT_BACKOFF_MS = 30_000;
// Covers the deep pass (XL can take 20 minutes), the Dify stream and margin,
// so a healthy multi-tick run is never reaped; a crashed tick is failed at
// the deadline instead of trusted or silently re-run.
export const VOICE_ASSESSMENT_DEADLINE_MS =
	DEEP_RESEARCH_TIMEOUT_MS + DIFY_RUN_TIMEOUT_MS + 60_000;

export type AssessmentResearchStatus =
	'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

/** One due assessment row, normalized across the voice and interview stores. */
export type AssessmentTarget = {
	/** Voice conversation id or interview id. */
	key: string;
	ownerId: string;
	status: 'queued' | 'running';
	attempts: number;
	deadline: number | null;
	researchStatus: AssessmentResearchStatus;
	researchTaskId: string | null;
	researchDeadline: number | null;
	researchPollAt: number | null;
	transcript: string | null;
	/** Business intake as JSON text (parsed again by the report writer). */
	businessJson: string | null;
	reportLanguage: string;
	/** The in-call research cases as JSON text ('' or null when none). */
	inCallCasesJson: string | null;
	/** The stored deep-pass dossier JSON (null until the pass finished). */
	deepDossierJson: string | null;
};

export type AssessmentStore = {
	findDue(now: number): AssessmentTarget | undefined;
	/** Fresh re-read before the Dify write, so both evidence blobs are new. */
	revalidate(key: string): AssessmentTarget | undefined;
	claim(key: string, deadline: number): void;
	retry(key: string, attempts: number, after: number): void;
	fail(key: string, attempts: number): void;
	finish(key: string, reportId: string): void;
	claimResearch(key: string): void;
	saveResearchTask(
		key: string,
		taskId: string,
		deadline: number,
		nextPoll: number,
	): void;
	deferResearchPoll(key: string, nextPoll: number): void;
	finishResearch(key: string, dossier: string | null): void;
	/** Inserts the ready report (+ owner/staff mails) and returns its id. */
	writeReport(
		target: AssessmentTarget,
		report: string,
		nowIsoText: string,
	): string;
};

function warn(message: string, key: string, error: unknown): void {
	const detail = error instanceof ProviderError ? ` (${error.message})` : '';
	console.warn(`[voice] ${message} for ${key}${detail}`);
}

/**
 * Processes at most one due assessment through the given store; true when
 * work was done so the worker loop can continue immediately.
 */
export async function processNextAssessment(
	store: AssessmentStore,
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	const target = store.findDue(now);
	if (!target) {
		return false;
	}
	await runAssessmentJob(target, providers, now, pollMs, store);
	return true;
}

export async function runAssessmentJob(
	target: AssessmentTarget,
	providers: VoiceProviders,
	now: number,
	pollMs: number,
	store: AssessmentStore,
): Promise<void> {
	const key = target.key;
	if (target.status === 'running') {
		if ((target.deadline ?? 0) > now) {
			// A healthy multi-tick run (deep pass polling): advance it.
			await advanceAssessment(target, providers, now, pollMs, store);
			return;
		}
		// Deadline passed mid-run: the outcome is unknown, so the row is
		// failed honestly instead of trusted or silently re-run.
		store.fail(key, target.attempts + 1);
		return;
	}
	store.claim(key, now + VOICE_ASSESSMENT_DEADLINE_MS);
	await advanceAssessment(
		{
			...target,
			status: 'running',
			deadline: now + VOICE_ASSESSMENT_DEADLINE_MS,
		},
		providers,
		now,
		pollMs,
		store,
	);
}

/** Advances a running assessment by one step, down to the Dify write. */
async function advanceAssessment(
	target: AssessmentTarget,
	providers: VoiceProviders,
	now: number,
	pollMs: number,
	store: AssessmentStore,
): Promise<void> {
	const key = target.key;
	const researchStatus = target.researchStatus;

	if (researchStatus === 'idle') {
		store.claimResearch(key);
		const business = parseVoiceBusiness(target.businessJson) ?? {
			businessName: '',
			location: '',
		};
		let task: string;
		try {
			task = await providers.startResearch(business, {
				reasoningDepth: DEEP_RESEARCH_REASONING_DEPTH,
				output: 'report',
				prompt: deepResearchPrompt(
					business,
					target.transcript ?? '',
					TOPICS,
					target.reportLanguage as 'ja' | 'en',
				),
			});
		} catch (error) {
			// Graceful like the in-call pass: the report ships without the
			// deep dossier instead of blocking the owner's report.
			store.finishResearch(key, null);
			warn('Deep research submission failed', key, error);
			return;
		}
		store.saveResearchTask(
			key,
			task,
			now + DEEP_RESEARCH_TIMEOUT_MS,
			now + pollMs,
		);
		return;
	}
	if (researchStatus === 'submitting') {
		// A previous tick died during submission; the deadline reap decides.
		return;
	}
	if (researchStatus === 'polling') {
		if (
			target.researchDeadline !== null
			&& now >= target.researchDeadline
		) {
			store.finishResearch(key, null);
			return;
		}
		let result: Awaited<ReturnType<VoiceProviders['pollResearchReport']>>;
		try {
			result = await providers.pollResearchReport(
				target.researchTaskId ?? '',
			);
		} catch (error) {
			const permanentHttpError =
				error instanceof ProviderError
				&& error.status < 500
				&& error.status !== 408
				&& error.status !== 429;
			if (permanentHttpError) {
				store.finishResearch(key, null);
				warn('Deep research polling failed', key, error);
			} else {
				store.deferResearchPoll(key, now + pollMs);
			}
			return;
		}
		if (result.status === 'waiting') {
			store.deferResearchPoll(key, now + pollMs);
			return;
		}
		store.finishResearch(
			key,
			result.status === 'completed' ?
				JSON.stringify(result.report)
			:	null,
		);
	}
	// Research terminal (completed or failed): write the report. Re-read the
	// row so both pieces of evidence are the freshly stored ones.
	const current = store.revalidate(key);
	if (!current) {
		return;
	}
	let report: string;
	try {
		report = await providers.runAssessment({
			conversationId: key,
			transcript: current.transcript ?? '',
			business: current.businessJson ?? '',
			cases: JSON.stringify({
				in_call_cases: parseVoiceCases(current.inCallCasesJson),
				deep_research_report: parseDeepReport(current.deepDossierJson),
			}),
			language: current.reportLanguage as 'ja' | 'en',
		});
	} catch (error) {
		const attempts = current.attempts + 1;
		if (attempts >= VOICE_ASSESSMENT_MAX_ATTEMPTS) {
			store.fail(key, attempts);
			warn('Assessment failed permanently', key, error);
		} else {
			store.retry(
				key,
				attempts,
				now + 2 ** attempts * VOICE_ASSESSMENT_BACKOFF_MS,
			);
			warn('Assessment attempt failed, will retry', key, error);
		}
		return;
	}
	const reportId = store.writeReport(current, report, nowIso());
	store.finish(key, reportId);
}

/** The stored deep-pass dossier JSON, safely re-parsed. */
export function parseDeepReport(
	raw: string | null,
): VoiceResearchReport | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		const entry = object(parsed);
		const answer = entry?.answer;
		if (typeof answer !== 'string' || !answer.trim()) {
			return null;
		}
		return {
			answer,
			sources: Array.isArray(entry?.sources) ? entry.sources : [],
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Voice-session store: existing conversations keep their assessment
// lifecycle; their reports are born ready with voice_conversation_id set.
// ---------------------------------------------------------------------------

function toVoiceAssessmentTarget(row: VoiceSessionRow): AssessmentTarget {
	return {
		key: row.conversation_id,
		ownerId: row.owner_id,
		status: row.assessment_status === 'running' ? 'running' : 'queued',
		attempts: row.assessment_attempts,
		deadline: row.assessment_deadline,
		researchStatus: row.assessment_research_status,
		researchTaskId: row.assessment_research_task_id,
		researchDeadline: row.assessment_research_deadline,
		researchPollAt: row.assessment_research_poll_at,
		transcript: row.transcript,
		businessJson: row.business,
		reportLanguage: row.report_language,
		inCallCasesJson: row.research_cases,
		deepDossierJson: row.assessment_research_cases,
	};
}

export const voiceAssessmentStore: AssessmentStore = {
	findDue(now) {
		const row = findDueVoiceAssessment(now);
		return row ? toVoiceAssessmentTarget(row) : undefined;
	},
	revalidate(key) {
		const row = findVoiceSessionByConversation(key);
		return row ? toVoiceAssessmentTarget(row) : undefined;
	},
	claim(key, deadline) {
		claimVoiceAssessment(key, deadline);
	},
	retry(key, attempts, after) {
		retryVoiceAssessment(key, attempts, after);
	},
	fail(key, attempts) {
		failVoiceAssessment(key, attempts);
	},
	finish(key, reportId) {
		finishVoiceAssessment(key, reportId);
	},
	claimResearch(key) {
		claimAssessmentResearch(key);
	},
	saveResearchTask(key, taskId, deadline, nextPoll) {
		saveAssessmentTask(key, taskId, deadline, nextPoll);
	},
	deferResearchPoll(key, nextPoll) {
		deferAssessmentPoll(key, nextPoll);
	},
	finishResearch(key, dossier) {
		finishAssessmentResearch(key, dossier);
	},
	writeReport(target, report, nowIsoText) {
		const reportId = newId();
		// Voice reports are born ready: the pending state + generic generator
		// is the interview flow's; here the assessment lifecycle on the voice
		// row owns retries, so the report row records the outcome directly.
		inTransaction((db) => {
			db.prepare(
				`INSERT INTO reports
					(id, interview_id, voice_conversation_id, owner_id, business_name, locale,
					generator, status, content, failure_reason, consultation_requested_at,
					created_at, ready_at, generate_attempts, generate_after)
				 VALUES (?, NULL, ?, ?, ?, ?, 'dify', 'ready', ?, NULL, NULL, ?, ?, 0, NULL)`,
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

/** Voice wrapper kept for the worker and existing callers. */
export async function processNextVoiceAssessment(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	return processNextAssessment(voiceAssessmentStore, now, providers, pollMs);
}
