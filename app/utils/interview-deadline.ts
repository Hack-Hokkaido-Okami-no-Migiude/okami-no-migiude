// Deadline math for the one-hour interview window (contract §5). The server
// wall clock owns `deadlineAt`; the browser only derives a countdown from it
// and enforces a hard cut at (and after) the deadline. Pure module — safe to
// unit-test from node and to import from Nuxt code.

export const INTERVIEW_WINDOW_MS = 60 * 60 * 1000;

export type DeadlineAnnouncementKey =
	| 'remaining_5_minutes'
	| 'remaining_1_minute'
	| 'remaining_30_seconds'
	| 'remaining_10_seconds';

/** Parses a wire-format ISO 8601 UTC deadline into epoch milliseconds. */
export function parseDeadlineMs(deadlineAt: string): number {
	if (typeof deadlineAt !== 'string') {
		throw new RangeError('deadlineAt must be an ISO 8601 string');
	}
	const parsed = Date.parse(deadlineAt);
	if (Number.isNaN(parsed)) {
		throw new RangeError(
			`invalid deadlineAt: ${JSON.stringify(deadlineAt)}`,
		);
	}
	return parsed;
}

export type DeadlineState = { remainingMs: number; passed: boolean };

export function deadlineState(
	deadlineMs: number,
	nowMs: number,
): DeadlineState {
	return {
		remainingMs: Math.max(0, deadlineMs - nowMs),
		passed: nowMs >= deadlineMs,
	};
}

/**
 * Hard-cut gate: a late event (transcript chunk, submit) may only be accepted
 * while time remains. Evaluated at the moment of acceptance, never cached.
 */
export function canAcceptEvent(deadlineMs: number, nowMs: number): boolean {
	return nowMs < deadlineMs;
}

/** Renders remaining time as zero-padded `MM:SS`. */
export function formatRemaining(remainingMs: number): string {
	const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const ANNOUNCE_THRESHOLDS: ReadonlyArray<
	readonly [DeadlineAnnouncementKey, number]
> = [
	['remaining_5_minutes', 5 * 60_000],
	['remaining_1_minute', 60_000],
	['remaining_30_seconds', 30_000],
	['remaining_10_seconds', 10_000],
];

/** The strictest time threshold that is currently active, if any. */
export function announcementsCrossed(
	previousRemainingMs: number,
	currentRemainingMs: number,
): DeadlineAnnouncementKey[] {
	return ANNOUNCE_THRESHOLDS.filter(
		([, threshold]) =>
			previousRemainingMs > threshold && currentRemainingMs <= threshold,
	).map(([key]) => key);
}
