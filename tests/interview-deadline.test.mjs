// Unit tests for the interview deadline/hard-cut logic and the reactive
// countdown controller. Pure node:test — no app build required.
import assert from 'node:assert/strict';
import {
	announcementsCrossed,
	canAcceptEvent,
	deadlineState,
	formatRemaining,
	parseDeadlineMs,
} from '../app/utils/interview-deadline.ts';
import { createInterviewTimer } from '../app/composables/useInterviewTimer.ts';
import { ref } from 'vue';
import test from 'node:test';

const DEADLINE_AT = '2026-11-25T09:00:00.000Z';
const DEADLINE_MS = Date.parse(DEADLINE_AT);

test('parseDeadlineMs accepts contract ISO timestamps and rejects junk', () => {
	assert.equal(parseDeadlineMs(DEADLINE_AT), DEADLINE_MS);
	// Same instant without milliseconds is still a valid ISO instant.
	assert.equal(parseDeadlineMs('2026-11-25T09:00:00Z'), DEADLINE_MS);
	assert.throws(() => parseDeadlineMs('not-a-date'), RangeError);
	assert.throws(() => parseDeadlineMs(''), RangeError);
	assert.throws(
		// @ts-expect-error - defensive runtime check for null input
		() => parseDeadlineMs(null),
		RangeError,
	);
});

test('deadlineState: remaining time, passed at equality, clamped after', () => {
	assert.deepEqual(deadlineState(DEADLINE_MS, DEADLINE_MS - 3_600_000), {
		remainingMs: 3_600_000,
		passed: false,
	});
	assert.deepEqual(deadlineState(DEADLINE_MS, DEADLINE_MS - 1_500), {
		remainingMs: 1_500,
		passed: false,
	});
	// At exactly the deadline the interview is over (hard cut).
	assert.deepEqual(deadlineState(DEADLINE_MS, DEADLINE_MS), {
		remainingMs: 0,
		passed: true,
	});
	assert.deepEqual(deadlineState(DEADLINE_MS, DEADLINE_MS + 42_000), {
		remainingMs: 0,
		passed: true,
	});
});

test('canAcceptEvent is the hard-cut gate for late events', () => {
	assert.equal(canAcceptEvent(DEADLINE_MS, DEADLINE_MS - 1), true);
	assert.equal(canAcceptEvent(DEADLINE_MS, DEADLINE_MS), false);
	assert.equal(canAcceptEvent(DEADLINE_MS, DEADLINE_MS + 1), false);
});

test('formatRemaining renders MM:SS', () => {
	assert.equal(formatRemaining(3_600_000), '60:00');
	assert.equal(formatRemaining(90_000), '01:30');
	assert.equal(formatRemaining(59_999), '00:59');
	assert.equal(formatRemaining(0), '00:00');
	assert.equal(formatRemaining(-5), '00:00');
});

test('announcementsCrossed maps threshold crossings', () => {
	assert.deepEqual(announcementsCrossed(300_001, 300_000), [
		'remaining_5_minutes',
	]);
	assert.deepEqual(announcementsCrossed(60_001, 60_000), [
		'remaining_1_minute',
	]);
	assert.deepEqual(announcementsCrossed(30_001, 30_000), [
		'remaining_30_seconds',
	]);
	assert.deepEqual(announcementsCrossed(10_001, 10_000), [
		'remaining_10_seconds',
	]);
	// Staying inside a band announces nothing.
	assert.deepEqual(announcementsCrossed(300_000, 299_999), []);
	assert.deepEqual(announcementsCrossed(59_999, 30_001), []);
	// A suspended tab can cross several thresholds in one tick.
	assert.deepEqual(announcementsCrossed(120_000, 5_000), [
		'remaining_1_minute',
		'remaining_30_seconds',
		'remaining_10_seconds',
	]);
});

function fakeClock(startMs) {
	let nowMs = startMs;
	const scheduled = [];
	return {
		now: () => nowMs,
		advance(ms) {
			nowMs += ms;
		},
		schedule(callback, intervalMs) {
			const entry = { callback, intervalMs, cancelled: false };
			scheduled.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
		ticks() {
			return scheduled;
		},
		cancelledCount() {
			return scheduled.filter((entry) => entry.cancelled).length;
		},
	};
}

test('timer counts down from the server deadline and announces once', () => {
	const clock = fakeClock(DEADLINE_MS - 3_600_000);
	const deadlineAt = ref(DEADLINE_AT);
	const timer = createInterviewTimer({
		deadlineAt,
		now: clock.now,
		schedule: clock.schedule,
	});

	assert.equal(timer.remainingMs.value, 3_600_000);
	assert.equal(timer.remainingText.value, '60:00');
	assert.equal(timer.passed.value, false);

	// Simulate scheduled ticks while the clock advances.
	function drainTicks() {
		for (const entry of clock.ticks()) {
			if (!entry.cancelled) {
				entry.callback();
			}
		}
	}

	const seen = [];
	function pumpAndCollect() {
		drainTicks();
		if (timer.announcement.value) {
			seen.push(timer.announcement.value);
			timer.clearAnnouncement();
		}
	}

	// Advance just past each announcement threshold.
	clock.advance(3_600_000 - 300_000 + 1);
	pumpAndCollect();
	clock.advance(240_000 + 1);
	pumpAndCollect();
	clock.advance(30_000 + 1);
	pumpAndCollect();
	clock.advance(20_000 + 1);
	pumpAndCollect();

	assert.deepEqual(seen, [
		'remaining_5_minutes',
		'remaining_1_minute',
		'remaining_30_seconds',
		'remaining_10_seconds',
	]);

	// Crossing the deadline flips passed and clamps to zero.
	clock.advance(10_000);
	drainTicks();
	assert.equal(timer.passed.value, true);
	assert.equal(timer.remainingMs.value, 0);
	assert.equal(timer.remainingText.value, '00:00');
});

test('timer stops scheduling once the deadline has passed', () => {
	const clock = fakeClock(DEADLINE_MS - 1_000);
	const deadlineAt = ref(DEADLINE_AT);
	createInterviewTimer({
		deadlineAt,
		now: clock.now,
		schedule: clock.schedule,
	});
	assert.equal(clock.cancelledCount(), 0);
	clock.advance(2_000);
	for (const entry of clock.ticks()) {
		if (!entry.cancelled) {
			entry.callback();
		}
	}
	assert.ok(clock.cancelledCount() >= 1, 'scheduler must be cancelled');
});

test('timer handles a missing deadline and resets on a new one', () => {
	const clock = fakeClock(DEADLINE_MS - 3_600_000);
	const deadlineAt = ref(null);
	const timer = createInterviewTimer({
		deadlineAt,
		now: clock.now,
		schedule: clock.schedule,
	});
	assert.equal(timer.remainingMs.value, null);
	assert.equal(timer.remainingText.value, '');
	assert.equal(timer.passed.value, false);

	deadlineAt.value = DEADLINE_AT;
	for (const entry of clock.ticks()) {
		if (!entry.cancelled) {
			entry.callback();
		}
	}
	assert.equal(timer.remainingMs.value, 3_600_000);
	assert.equal(timer.remainingText.value, '60:00');

	// A new interview deadline resets announcement bookkeeping.
	clock.advance(3_600_000 - 300_000 + 1);
	for (const entry of clock.ticks()) {
		if (!entry.cancelled) {
			entry.callback();
		}
	}
	assert.equal(timer.announcement.value, 'remaining_5_minutes');
	deadlineAt.value = '2026-12-01T09:00:00.000Z';
	assert.equal(timer.announcement.value, null);
});

test('timer dispose cancels the scheduler', () => {
	const clock = fakeClock(DEADLINE_MS - 3_600_000);
	const timer = createInterviewTimer({
		deadlineAt: ref(DEADLINE_AT),
		now: clock.now,
		schedule: clock.schedule,
	});
	assert.equal(clock.cancelledCount(), 0);
	timer.dispose();
	assert.equal(clock.cancelledCount(), 1);
});
