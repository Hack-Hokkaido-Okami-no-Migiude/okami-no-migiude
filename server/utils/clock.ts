// Server clock. Every timestamp the API or queue produces flows through here,
// so CLOCK_OFFSET_MS (QA clock injection) shifts the whole server coherently.
import { clockOffsetMs } from './env';

export function nowMs(): number {
	return Date.now() + clockOffsetMs();
}

/** ISO 8601 UTC with milliseconds and Z — the one format everywhere (§3). */
export function nowIso(): string {
	return new Date(nowMs()).toISOString();
}

export function isoPlusMs(iso: string, deltaMs: number): string {
	return new Date(Date.parse(iso) + deltaMs).toISOString();
}
