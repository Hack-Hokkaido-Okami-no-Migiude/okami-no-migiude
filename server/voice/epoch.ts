// The active-epoch registry: at most ONE live capture epoch per scope key
// (the route passes a scope like a private client/session reference). This is
// process-local bookkeeping only — the durable consent/epoch state belongs to
// the store, which this seam deliberately does not touch. A second acquire
// for an active scope fails with the typed `epoch_active` conflict so the
// guarded route can answer 409 without re-deriving the rule. An acquired
// epoch that is never released is force-released after the bounded lifetime,
// so one leaked epoch can never wedge a session forever.
import { type Clock, realClock } from './clock';
import { VoiceError } from './errors';

/** Hard default lifetime of one acquired epoch in the registry. */
export const DEFAULT_EPOCH_LIFETIME_MS = 35 * 60 * 1_000;

export type VoiceEpoch = {
	readonly id: string;
	readonly scopeKey: string;
	readonly startedAtMs: number;
	/** Idempotent; the second release is a no-op. */
	release(): void;
};

export type AcquireEpochOptions = {
	lifetimeMs?: number;
	idFactory?: () => string;
	clock?: Clock;
};

export class VoiceEpochRegistry {
	private readonly active = new Map<string, { epoch: VoiceEpoch; timer: { clear(): void } | null }>();

	/**
	 * Acquire the single active epoch for a scope, or throw the typed
	 * conflict when one is already active. The returned epoch must be
	 * released (by the adapter's close or the route's stop flow).
	 */
	acquire(scopeKey: string, options: AcquireEpochOptions = {}): VoiceEpoch {
		const existing = this.active.get(scopeKey);
		if (existing) {
			throw new VoiceError(
				'epoch_active',
				'A live capture epoch is already active for this session; stop it before starting a new one.',
			);
		}
		const clock = options.clock ?? realClock;
		const lifetimeMs = options.lifetimeMs ?? DEFAULT_EPOCH_LIFETIME_MS;
		const id = options.idFactory ? options.idFactory() : cryptoRandomId();
		const epoch: VoiceEpoch = {
			id,
			scopeKey,
			startedAtMs: clock.now(),
			release: () => {
				this.release(scopeKey, epoch);
			},
		};
		const timer = clock.setTimeout(() => {
			// Bounded lifetime: never let a leaked epoch block the scope.
			this.release(scopeKey, epoch);
		}, lifetimeMs);
		this.active.set(scopeKey, { epoch, timer });
		return epoch;
	}

	/** The active epoch id for a scope, or null. */
	activeEpochId(scopeKey: string): string | null {
		return this.active.get(scopeKey)?.epoch.id ?? null;
	}

	private release(scopeKey: string, epoch: VoiceEpoch): void {
		const entry = this.active.get(scopeKey);
		if (!entry || entry.epoch !== epoch) {
			return;
		}
		entry.timer?.clear();
		this.active.delete(scopeKey);
	}
}

function cryptoRandomId(): string {
	return globalThis.crypto.randomUUID();
}
