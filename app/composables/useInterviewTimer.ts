// Reactive countdown for the interview window. The server `deadlineAt` is the
// single source of truth; this controller only renders it and fires the
// hard-cut signal (`passed`). Ticking is injectable so unit tests can drive it
// synchronously without real timers.
import {
	type DeadlineAnnouncementKey,
	announcementsCrossed,
	deadlineState,
	formatRemaining,
	parseDeadlineMs,
} from '../utils/interview-deadline.ts';
import {
	type ComputedRef,
	type Ref,
	computed,
	onScopeDispose,
	ref,
	watch,
} from 'vue';

export type TimerScheduler = (
	callback: () => void,
	intervalMs: number,
) => () => void;

export type InterviewTimerController = {
	/** Milliseconds remaining, or null when no deadline is known. */
	remainingMs: ComputedRef<number | null>;
	remainingText: ComputedRef<string>;
	passed: ComputedRef<boolean>;
	/** Fires once per unseen threshold; the UI clears it after announcing. */
	announcement: Ref<DeadlineAnnouncementKey | null>;
	clearAnnouncement(): void;
	/** Cancels the scheduler; safe to call more than once. */
	dispose(): void;
};

const TICK_MS = 250;

function clientScheduler(): TimerScheduler {
	return (callback, intervalMs) => {
		if (typeof window === 'undefined') {
			return () => {};
		}
		const handle = window.setInterval(callback, intervalMs);
		return () => {
			window.clearInterval(handle);
		};
	};
}

export function createInterviewTimer(options: {
	deadlineAt: Ref<string | null>;
	now?: () => number;
	schedule?: TimerScheduler;
}): InterviewTimerController {
	const now = options.now ?? (() => Date.now());
	const schedule = options.schedule ?? clientScheduler();
	const deadlineAt = options.deadlineAt;

	const nowRef = ref(now());
	const announcement = ref<DeadlineAnnouncementKey | null>(null);
	let cancelTick: (() => void) | null = null;
	let stopped = false;
	const seenAnnouncements = new Set<DeadlineAnnouncementKey>();

	const deadlineMs = computed(() => {
		const value = deadlineAt.value;
		if (value === null) {
			return null;
		}
		try {
			return parseDeadlineMs(value);
		} catch {
			return null;
		}
	});

	const remainingMs = computed(() => {
		const ms = deadlineMs.value;
		if (ms === null) {
			return null;
		}
		return deadlineState(ms, nowRef.value).remainingMs;
	});

	const passed = computed(() => {
		const ms = deadlineMs.value;
		if (ms === null) {
			return false;
		}
		return deadlineState(ms, nowRef.value).passed;
	});

	const remainingText = computed(() => {
		const ms = remainingMs.value;
		return ms === null ? '' : formatRemaining(ms);
	});

	function tick() {
		if (stopped) {
			return;
		}
		const previousMs = deadlineMs.value;
		const previousRemaining =
			previousMs === null ? null : (
				deadlineState(previousMs, nowRef.value).remainingMs
			);
		nowRef.value = now();
		const ms = deadlineMs.value;
		if (ms === null) {
			return;
		}
		const state = deadlineState(ms, nowRef.value);
		if (state.passed) {
			stopped = true;
			cancelTick?.();
			cancelTick = null;
			return;
		}
		if (previousRemaining === null) {
			return;
		}
		for (const key of announcementsCrossed(
			previousRemaining,
			state.remainingMs,
		)) {
			if (!seenAnnouncements.has(key)) {
				seenAnnouncements.add(key);
				announcement.value = key;
			}
		}
	}

	function arm() {
		if (stopped || cancelTick !== null || deadlineMs.value === null) {
			return;
		}
		cancelTick = schedule(tick, TICK_MS);
	}

	// A new interview deadline resets announcement bookkeeping and restarts
	// ticking. `flush: 'sync'` keeps tests and page wiring deterministic.
	watch(
		deadlineAt,
		() => {
			seenAnnouncements.clear();
			announcement.value = null;
			cancelTick?.();
			cancelTick = null;
			stopped = false;
			arm();
		},
		{ flush: 'sync' },
	);

	arm();

	return {
		remainingMs,
		remainingText,
		passed,
		announcement,
		clearAnnouncement() {
			announcement.value = null;
		},
		dispose() {
			stopped = true;
			cancelTick?.();
			cancelTick = null;
		},
	};
}

/** Nuxt-facing wrapper: disposes with the component scope. */
export function useInterviewTimer(
	deadlineAt: Ref<string | null>,
): InterviewTimerController {
	const controller = createInterviewTimer({ deadlineAt });
	onScopeDispose(() => controller.dispose());
	return controller;
}
