// Injectable clock for bounded connection lifecycles. Production uses the
// real timer clock; tests inject a manual clock so timeouts and caps are
// exercised deterministically without waiting on wall time.
export type ClockTimer = { clear(): void };

export type Clock = {
	now(): number;
	setTimeout(callback: () => void, ms: number): ClockTimer;
};

/** The production clock on top of the Node timer APIs. Timers are unref'd so
 * pending lifecycle bounds never keep the process alive on shutdown. */
export const realClock: Clock = {
	now: () => Date.now(),
	setTimeout(callback, ms) {
		const handle = setTimeout(callback, ms);
		if (typeof handle.unref === 'function') {
			handle.unref();
		}
		return {
			clear: () => {
				clearTimeout(handle);
			},
		};
	},
};
