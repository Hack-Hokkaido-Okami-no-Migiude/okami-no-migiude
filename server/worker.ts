// In-process background worker (approved override): a single periodic loop
// that turns pending reports into ready reports (writing owner and staff
// messages transactionally) and delivers due outbox mails. No separate jobs
// table is needed — durable pending/queued state lives on the rows themselves,
// so boot recovery is inherent: pending rows are simply picked up again.
import { enqueueReportReadyMails, processQueuedMail } from './mail';
import {
	findOwnerProfileRow,
	findPendingReportDue,
	markReportFailed,
	markReportGenerateRetry,
} from './model/reports';

import { nowIso, nowMs } from './utils/clock';
import type { ReportRow } from './model/reports';
import { findInterviewById } from './model/interviews';
import { generateReportContent } from './analyze';
import { inTransaction } from './utils/db';
import { sanitizeError } from './utils/errors';
import { workerPollMs } from './utils/env';
import {
	readVoiceConfig,
	voiceConfigured,
	difyConfigured,
} from './voice/config';
import { createVoiceProviders } from './voice/providers';
import { processNextVoiceResearch } from './voice/jobs';
import { processNextVoiceAssessment } from './voice/assessment';
import { processNextInterviewResearch } from './interviews/research';
import { processNextInterviewAssessment } from './interviews/assessment';
import { syncToNeonIfDue } from './neon/sync';

const MAX_ATTEMPTS = 5;

export function startWorker(): void {
	const global = globalThis as typeof globalThis & {
		__okamiWorkerStarted?: boolean;
	};
	if (global.__okamiWorkerStarted) {
		return;
	}
	global.__okamiWorkerStarted = true;
	// Voice research awaits provider I/O, so the tick is async with a
	// re-entrancy guard: a slow Dify/Linkup call never overlaps itself.
	let running = false;
	const timer = setInterval(() => {
		if (running) {
			return;
		}
		running = true;
		void processDueWork()
			.catch((error) => {
				console.error('[worker] tick failed:', error);
			})
			.finally(() => {
				running = false;
			});
	}, workerPollMs());
	timer.unref?.();
}

async function processDueWork(): Promise<void> {
	await syncToNeonIfDue();
	for (let guard = 0; guard < 50; guard += 1) {
		const didReport = processNextReport();
		const didVoice = await processNextVoice();
		const didAssessment = await processNextAssessment();
		const didInterviewResearch = await processInterviewResearch();
		const didInterviewAssessment = await processInterviewAssessment();
		const didMail = processQueuedMail();
		if (
			!didReport
			&& !didVoice
			&& !didAssessment
			&& !didInterviewResearch
			&& !didInterviewAssessment
			&& !didMail
		) {
			return;
		}
	}
}

function processNextVoice(): Promise<boolean> {
	if (!voiceConfigured()) {
		return Promise.resolve(false);
	}
	return processNextVoiceResearch(
		nowMs(),
		createVoiceProviders(readVoiceConfig()),
	);
}

function processNextAssessment(): Promise<boolean> {
	if (!difyConfigured()) {
		return Promise.resolve(false);
	}
	return processNextVoiceAssessment(
		nowMs(),
		createVoiceProviders(readVoiceConfig()),
	);
}

/** Live-interview research reuses the voice providers (Linkup tools). */
function processInterviewResearch(): Promise<boolean> {
	if (!voiceConfigured()) {
		return Promise.resolve(false);
	}
	return processNextInterviewResearch(
		nowMs(),
		createVoiceProviders(readVoiceConfig()),
	);
}

function processInterviewAssessment(): Promise<boolean> {
	if (!difyConfigured()) {
		return Promise.resolve(false);
	}
	return processNextInterviewAssessment(
		nowMs(),
		createVoiceProviders(readVoiceConfig()),
	);
}

function processNextReport(): boolean {
	const report = findPendingReportDue(nowMs());
	if (!report) {
		return false;
	}
	try {
		generateAndEnqueue(report);
	} catch (error) {
		handleGenerationFailure(report, error);
	}
	return true;
}

function generateAndEnqueue(report: ReportRow): void {
	const interview = findInterviewById(report.interview_id);
	if (!interview || !interview.transcript) {
		markReportFailed(report.id, 'Interview transcript is missing');
		return;
	}
	// Live mode has no verified adapter in this slice: fail honestly instead
	// of faking an external call (§10). No network request is ever made.
	if (interview.mode === 'live') {
		markReportFailed(report.id, 'Live analysis is not configured');
		return;
	}
	const content = generateReportContent(
		interview.transcript,
		{
			businessName: report.business_name,
			municipality:
				findOwnerProfileRow(report.owner_id)?.municipality ?? '',
			locale: report.locale,
		},
		nowIso(),
	);
	inTransaction((db) => {
		const changed = db
			.prepare(
				"UPDATE reports SET status = 'ready', content = ?, ready_at = ?, generate_attempts = generate_attempts + 1 WHERE id = ? AND status = 'pending'",
			)
			.run(content, nowIso(), report.id);
		if (Number(changed.changes) > 0) {
			enqueueReportReadyMails(db, report);
		}
	});
}

function handleGenerationFailure(report: ReportRow, error: unknown): void {
	const attempts = report.generate_attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		markReportFailed(report.id, sanitizeError(error));
		return;
	}
	markReportGenerateRetry(
		report.id,
		attempts,
		nowMs() + 2 ** attempts * 30_000,
	);
}
