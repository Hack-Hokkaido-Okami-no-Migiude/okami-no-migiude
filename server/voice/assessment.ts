// Post-call assessment job, phased across worker ticks: (1) submit a second,
// transcript-informed Linkup deep pass at the heaviest reasoning depth — a
// full sourced dossier, not a case list, (2) poll it exactly like the
// in-call research, (3) write the Dify report from the transcript, the
// business intake and the research evidence (in-call cases plus the deep
// dossier) and mail it. Deep-pass failure is graceful — the report ships
// with the in-call cases; only the Dify write retries. State lives on the
// voice session row (same pattern as the research job), so a crashed tick
// resumes or is failed at the deadline.
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
	claimAssessmentResearch,
	claimVoiceAssessment,
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

function warn(message: string, conversationId: string, error: unknown): void {
	const detail = error instanceof ProviderError ? ` (${error.message})` : '';
	console.warn(`[voice] ${message} for ${conversationId}${detail}`);
}

/** Processes at most one due voice assessment; true when work was done. */
export async function processNextVoiceAssessment(
	now: number,
	providers: VoiceProviders,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<boolean> {
	const session = findDueVoiceAssessment(now);
	if (!session) {
		return false;
	}
	await runVoiceAssessmentJob(session, providers, now, pollMs);
	return true;
}

export async function runVoiceAssessmentJob(
	session: VoiceSessionRow,
	providers: VoiceProviders,
	now: number,
	pollMs = VOICE_POLL_INTERVAL_MS,
): Promise<void> {
	const id = session.conversation_id;
	if (session.assessment_status === 'running') {
		if ((session.assessment_deadline ?? 0) > now) {
			// A healthy multi-tick run (deep pass polling): advance it.
			await advanceVoiceAssessment(session, providers, now, pollMs);
			return;
		}
		// Deadline passed mid-run: the outcome is unknown, so the row is
		// failed honestly instead of trusted or silently re-run.
		failVoiceAssessment(id, session.assessment_attempts + 1);
		return;
	}
	claimVoiceAssessment(id, now + VOICE_ASSESSMENT_DEADLINE_MS);
	await advanceVoiceAssessment(
		{ ...session, assessment_deadline: now + VOICE_ASSESSMENT_DEADLINE_MS },
		providers,
		now,
		pollMs,
	);
}

/** Advances a running assessment by one step, down to the Dify write. */
async function advanceVoiceAssessment(
	session: VoiceSessionRow,
	providers: VoiceProviders,
	now: number,
	pollMs: number,
): Promise<void> {
	const id = session.conversation_id;
	const researchStatus = session.assessment_research_status;

	if (researchStatus === 'idle') {
		claimAssessmentResearch(id);
		const business = parseVoiceBusiness(session.business) ?? {
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
					session.transcript ?? '',
					TOPICS,
					session.report_language,
				),
			});
		} catch (error) {
			// Graceful like the in-call pass: the report ships without the
			// deep dossier instead of blocking the owner's report.
			finishAssessmentResearch(id, null);
			warn('Deep research submission failed', id, error);
			return;
		}
		saveAssessmentTask(
			id,
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
			session.assessment_research_deadline !== null
			&& now >= session.assessment_research_deadline
		) {
			finishAssessmentResearch(id, null);
			return;
		}
		let result: Awaited<ReturnType<VoiceProviders['pollResearchReport']>>;
		try {
			result = await providers.pollResearchReport(
				session.assessment_research_task_id ?? '',
			);
		} catch (error) {
			const permanentHttpError =
				error instanceof ProviderError
				&& error.status < 500
				&& error.status !== 408
				&& error.status !== 429;
			if (permanentHttpError) {
				finishAssessmentResearch(id, null);
				warn('Deep research polling failed', id, error);
			} else {
				deferAssessmentPoll(id, now + pollMs);
			}
			return;
		}
		if (result.status === 'waiting') {
			deferAssessmentPoll(id, now + pollMs);
			return;
		}
		finishAssessmentResearch(
			id,
			result.status === 'completed' ?
				JSON.stringify(result.report)
			:	null,
		);
	}
	// Research terminal (completed or failed): write the report. Re-read the
	// row so both pieces of evidence are the freshly stored ones.
	const current = findVoiceSessionByConversation(id);
	if (!current) {
		return;
	}
	let report: string;
	try {
		report = await providers.runAssessment({
			conversationId: id,
			transcript: current.transcript ?? '',
			business: current.business ?? '',
			cases: JSON.stringify({
				in_call_cases: parseVoiceCases(current.research_cases),
				deep_research_report: parseDeepReport(
					current.assessment_research_cases,
				),
			}),
			language: current.report_language,
		});
	} catch (error) {
		const attempts = current.assessment_attempts + 1;
		if (attempts >= VOICE_ASSESSMENT_MAX_ATTEMPTS) {
			failVoiceAssessment(id, attempts);
			warn('Assessment failed permanently', id, error);
		} else {
			retryVoiceAssessment(
				id,
				attempts,
				now + 2 ** attempts * VOICE_ASSESSMENT_BACKOFF_MS,
			);
			warn('Assessment attempt failed, will retry', id, error);
		}
		return;
	}
	const reportId = newId();
	// Voice reports are born ready: the pending state + generic generator is
	// the interview flow's; here the assessment lifecycle on the voice row
	// owns retries, so the report row records the outcome directly.
	inTransaction((db) => {
		db.prepare(
			`INSERT INTO reports
				(id, interview_id, voice_conversation_id, owner_id, business_name, locale,
				status, content, failure_reason, consultation_requested_at, created_at,
				ready_at, generate_attempts, generate_after)
			 VALUES (?, NULL, ?, ?, ?, ?, 'ready', ?, NULL, NULL, ?, ?, 0, NULL)`,
		).run(
			reportId,
			id,
			current.owner_id,
			parseVoiceBusiness(current.business)?.businessName ?? '',
			current.report_language,
			report,
			nowIso(),
			nowIso(),
		);
		enqueueReportReadyMails(db, {
			id: reportId,
			business_name:
				parseVoiceBusiness(current.business)?.businessName ?? '',
			locale: current.report_language,
			owner_id: current.owner_id,
		});
	});
	finishVoiceAssessment(id, reportId);
}

/** The stored deep-pass dossier JSON, safely re-parsed. */
function parseDeepReport(raw: string | null): VoiceResearchReport | null {
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
