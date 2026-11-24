// Deterministic clock double for lifecycle tests: timers only fire when the
// test advances virtual time, so bounds and timeouts are exercised exactly.
import type { Clock, ClockTimer } from '../../../server/voice/clock';

type Entry = {
	id: number;
	at: number;
	callback: () => void;
	cleared: boolean;
};

export class FakeClock implements Clock {
	private currentMs: number;
	private entries: Entry[] = [];
	private nextId = 1;

	constructor(startMs = 1_000_000) {
		this.currentMs = startMs;
	}

	now(): number {
		return this.currentMs;
	}

	setTimeout(callback: () => void, ms: number): ClockTimer {
		const entry: Entry = {
			id: this.nextId,
			at: this.currentMs + ms,
			callback,
			cleared: false,
		};
		this.nextId += 1;
		this.entries.push(entry);
		return {
			clear: () => {
				entry.cleared = true;
			},
		};
	}

	/** Advance virtual time, firing due timers in schedule order. */
	advance(ms: number): void {
		const target = this.currentMs + ms;
		for (;;) {
			const due = this.entries
				.filter((entry) => !entry.cleared && entry.at <= target)
				.sort((a, b) => (a.at - b.at) || (a.id - b.id))[0];
			if (!due) {
				break;
			}
			this.currentMs = Math.max(this.currentMs, due.at);
			due.cleared = true;
			due.callback();
		}
		this.currentMs = target;
	}

	/** Number of pending (not cleared, not fired) timers. */
	pendingCount(): number {
		return this.entries.filter((entry) => !entry.cleared).length;
	}
}
