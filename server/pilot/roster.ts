// Pure roster and consent mutation seam for the guarded private interview:
// stable seat ids bound to authenticated actors, one authoritative receipt per
// (seat, purpose) with notice version, actual provider and server time, and a
// stop signal for every change that invalidates live capture. No roster field
// is derived from speech or transcripts; labels are neutral owner input. No
// HTTP, store, provider or speech inference happens here — routes pass their
// verified actor id only, and the writer persists the returned state.
//
// Wiring (a later commit inside server/store/repository.ts, reusing its
// serialized commit queue the way commitShima does, with its own section):
// 1. Persist one PilotRosterState per session in an optional snapshot section
//    beside `shima`; validate it with PilotRosterStateSchema on read (fail
//    closed like readSnapshot) and before every write.
// 2. Ordinary commands (add-seat, remove-seat, record-consent): compare the
//    request's ordinary revision with the stored state.rev first; stale →
//    typed conflict, no write.
// 3. Safety commands (isPilotSafetyCommand → revoke-consent, plus the
//    interview stop/epoch close in its own writer): apply from the stored
//    current state WITHOUT comparing the request's revision — a stale ordinary
//    revision must never block a stop or a revoke.
// 4. Whenever a result carries stop: true, stop every active interview
//    epoch/stream for the session atomically with the commit (close transport
//    and provider work; resume only explicitly). Serialized with new send
//    admissions.
// 5. Skip the store write when result.state is the same object (no-op revoke).
// 6. Gate admission and every forward/send with canUsePilotConsent({
//    scope: pilotConsentScope(state, ids, localNoticeVersion), action,
//    receipts: pilotConsentReceipts(state, ids), confirmation }). Rate and
//    size limits stay at ingress; this seam only validates semantics.
import type {
	PilotConsentPurpose,
	PilotConsentReceipt,
	PilotConsentScope,
	PilotExternalPurpose,
} from './consent';
import { pilotIdPattern } from './principals';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type PilotSeatRole = 'owner' | 'coworker';

export type PilotSeat = Readonly<{
	/** Server-assigned stable seat id (`part_…`); never reused, removal keeps the row. */
	participantId: string;
	/** The authenticated principal bound to the seat; never a client-supplied claim. */
	actorId: string;
	role: PilotSeatRole;
	/** Neutral owner-supplied label; never derived from speech or transcripts. */
	label: string;
	addedAt: string;
	removedAt: string | null;
}>;

type StoredConsentBase = Readonly<{
	/** Roster version at record time; rows under older versions are inert. */
	rosterVersion: string;
	participantId: string;
	noticeVersion: string;
	status: 'active' | 'revoked';
	/** The authenticated seat that acknowledged personally; never another seat. */
	actorId: string;
	recordedAt: string;
	revokedAt: string | null;
}>;

export type PilotStoredConsent = StoredConsentBase
	& (
		| Readonly<{ purpose: 'local-capture'; provider: null; providerRevision: null }>
		| Readonly<{
				purpose: PilotExternalPurpose;
				/** Actual provider contacted, with its own server revision. */
				provider: string;
				providerRevision: string;
			}>
	);

export type PilotRosterState = Readonly<{
	/** The section's own compare-and-swap base, like a Shima section rev. */
	rev: number;
	/** Bumped only by seat changes; pilotRosterVersionOf derives the scope string. */
	rosterSeq: number;
	seats: readonly PilotSeat[];
	/** Authoritative current row per (participantId, purpose); revocation rewrites it. */
	consents: readonly PilotStoredConsent[];
}>;

export const PilotSeatSchema = z.strictObject({
	participantId: z.string().regex(/^part_[0-9a-f-]{36}$/),
	actorId: z.string().regex(pilotIdPattern),
	role: z.enum(['owner', 'coworker']),
	label: z.string().min(1).max(40),
	addedAt: z.string().min(1).max(40),
	removedAt: z.string().min(1).max(40).nullable(),
});

const consentBaseSchema = {
	rosterVersion: z.string().regex(pilotIdPattern),
	participantId: z.string().min(1),
	noticeVersion: z.string().regex(pilotIdPattern),
	status: z.enum(['active', 'revoked']),
	actorId: z.string().regex(pilotIdPattern),
	recordedAt: z.string().min(1).max(40),
	revokedAt: z.string().min(1).max(40).nullable(),
} as const;

export const PilotStoredConsentSchema = z.discriminatedUnion('purpose', [
	z.strictObject({
		...consentBaseSchema,
		purpose: z.literal('local-capture'),
		provider: z.null(),
		providerRevision: z.null(),
	}),
	z.strictObject({
		...consentBaseSchema,
		purpose: z.enum(['recorded-stt', 'live-voice', 'external-analysis']),
		provider: z.string().regex(pilotIdPattern),
		providerRevision: z.string().regex(pilotIdPattern),
	}),
]);

/** Durable DTO: validate persisted rows and every write with this schema. */
export const PilotRosterStateSchema = z.strictObject({
	rev: z.number().int().min(1),
	rosterSeq: z.number().int().min(1),
	seats: z.array(PilotSeatSchema),
	consents: z.array(PilotStoredConsentSchema),
});

export type PilotRosterCommand =
	| Readonly<{
			kind: 'add-seat';
			/** The acting owner's authenticated actor id. */
			actorId: string;
			/** The authenticated principal the new seat binds to. */
			seatActorId: string;
			role: PilotSeatRole;
			label: string;
			at: string;
		}>
	| Readonly<{
			kind: 'remove-seat';
			actorId: string;
			participantId: string;
			at: string;
		}>
	| Readonly<{
			kind: 'record-consent';
			/** Must be the named seat's own bound actor; no seat acts for another. */
			actorId: string;
			participantId: string;
			purpose: PilotConsentPurpose;
			noticeVersion: string;
			provider: string | null;
			providerRevision: string | null;
			at: string;
		}>
	| Readonly<{
			kind: 'revoke-consent';
			actorId: string;
			participantId: string;
			purpose: PilotConsentPurpose;
			at: string;
		}>;

export type PilotRosterFailureCode =
	| 'invalid_input'
	| 'not_found'
	| 'not_permitted'
	| 'actor_already_seated'
	| 'last_owner'
	| 'roster_full';

export type PilotRosterResult =
	| Readonly<{ ok: false; code: PilotRosterFailureCode }>
	| Readonly<{
			ok: true;
			/** Next durable state; the same object reference when nothing changed. */
			state: PilotRosterState;
			rev: number;
			/** Stop every active interview epoch/stream for the session now. */
			stop: boolean;
			/** Active receipt for consent writes; `null` on revoke. */
			consent: PilotStoredConsent | null;
			/** The new stable seat id for add-seat; otherwise `null`. */
			participantId: string | null;
		}>;

/** Only these commands must apply even when the request's ordinary revision is stale. */
export function isPilotSafetyCommand(command: PilotRosterCommand): boolean {
	return command.kind === 'revoke-consent';
}

export function emptyPilotRoster(): PilotRosterState {
	return Object.freeze({ rev: 1, rosterSeq: 1, seats: [], consents: [] });
}

export function pilotRosterVersionOf(state: PilotRosterState): string {
	return `rt${state.rosterSeq}`;
}

export function pilotActiveSeats(state: PilotRosterState): readonly PilotSeat[] {
	return state.seats.filter((seat) => seat.removedAt === null);
}

export function pilotActiveConsent(
	state: PilotRosterState,
	participantId: string,
	purpose: PilotConsentPurpose,
): PilotStoredConsent | null {
	const row = state.consents.find(
		(row) => row.participantId === participantId && row.purpose === purpose,
	);
	return row && row.status === 'active' ? row : null;
}

/** The consent.ts scope for the session's live roster under the configured local notice. */
export function pilotConsentScope(
	state: PilotRosterState,
	ids: Readonly<{ businessId: string; sessionId: string }>,
	localNoticeVersion: string,
): PilotConsentScope {
	return {
		businessId: ids.businessId,
		sessionId: ids.sessionId,
		rosterVersion: pilotRosterVersionOf(state),
		localNoticeVersion,
		roster: pilotActiveSeats(state).map(({ participantId, actorId }) => ({
			participantId,
			actorId,
		})),
	};
}

/** Current rows only, bound to the session ids; feed these to canUsePilotConsent. */
export function pilotConsentReceipts(
	state: PilotRosterState,
	ids: Readonly<{ businessId: string; sessionId: string }>,
): readonly PilotConsentReceipt[] {
	return state.consents.map((row): PilotConsentReceipt => {
		const receipt = {
			businessId: ids.businessId,
			sessionId: ids.sessionId,
			rosterVersion: row.rosterVersion,
			participantId: row.participantId,
			noticeVersion: row.noticeVersion,
			actorId: row.actorId,
			recordedAt: row.recordedAt,
			status: row.status,
		};
		return row.purpose === 'local-capture'
			? { ...receipt, purpose: 'local-capture', provider: null, providerRevision: null }
			: {
					...receipt,
					purpose: row.purpose,
					provider: row.provider,
					providerRevision: row.providerRevision,
				};
	});
}

function isId(value: unknown): value is string {
	return typeof value === 'string' && pilotIdPattern.test(value);
}

function isPurpose(value: unknown): value is PilotConsentPurpose {
	return (
		value === 'local-capture'
		|| value === 'recorded-stt'
		|| value === 'live-voice'
		|| value === 'external-analysis'
	);
}

function isTimestamp(value: unknown): value is string {
	return (
		typeof value === 'string'
		&& value.length <= 40
		&& !Number.isNaN(Date.parse(value))
	);
}

function isLabel(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	const trimmed = value.trim();
	return (
		trimmed.length >= 1
		&& trimmed.length <= 40
		&& !/[\p{Cc}]/u.test(trimmed)
	);
}

const maxSeats = 64;

function activeSeat(
	state: PilotRosterState,
	participantId: string,
): PilotSeat | null {
	const seat = state.seats.find(
		(row) => row.participantId === participantId && row.removedAt === null,
	);
	return seat ?? null;
}

function actingOwner(state: PilotRosterState, actorId: string): boolean {
	return state.seats.some(
		(seat) =>
			seat.removedAt === null
			&& seat.role === 'owner'
			&& seat.actorId === actorId,
	);
}

function addSeat(
	state: PilotRosterState,
	command: Extract<PilotRosterCommand, { kind: 'add-seat' }>,
): PilotRosterResult {
	const { actorId, seatActorId, role, at } = command;
	const label = isLabel(command.label) ? command.label.trim() : null;
	if (
		!isId(actorId)
		|| !isId(seatActorId)
		|| (role !== 'owner' && role !== 'coworker')
		|| label === null
		|| !isTimestamp(at)
	) {
		return { ok: false, code: 'invalid_input' };
	}
	const active = pilotActiveSeats(state);
	if (active.length >= maxSeats) {
		return { ok: false, code: 'roster_full' };
	}
	// Ingress requires an owner principal for seat changes; a fresh roster
	// bootstraps with an owner seat, otherwise the acting actor must hold an
	// active owner seat so an active owner always remains.
	if (active.length > 0 ? !actingOwner(state, actorId) : role !== 'owner') {
		return { ok: false, code: 'not_permitted' };
	}
	if (active.some((seat) => seat.actorId === seatActorId)) {
		return { ok: false, code: 'actor_already_seated' };
	}
	const seat: PilotSeat = Object.freeze({
		participantId: `part_${randomUUID()}`,
		actorId: seatActorId,
		role,
		label,
		addedAt: at,
		removedAt: null,
	});
	const next: PilotRosterState = Object.freeze({
		rev: state.rev + 1,
		rosterSeq: state.rosterSeq + 1,
		seats: Object.freeze([...state.seats, seat]),
		consents: state.consents,
	});
	return {
		ok: true,
		state: next,
		rev: next.rev,
		stop: true,
		consent: null,
		participantId: seat.participantId,
	};
}

function removeSeat(
	state: PilotRosterState,
	command: Extract<PilotRosterCommand, { kind: 'remove-seat' }>,
): PilotRosterResult {
	const { actorId, participantId, at } = command;
	if (!isId(actorId) || !isId(participantId) || !isTimestamp(at)) {
		return { ok: false, code: 'invalid_input' };
	}
	if (!actingOwner(state, actorId)) {
		return { ok: false, code: 'not_permitted' };
	}
	const seat = activeSeat(state, participantId);
	if (!seat) {
		return { ok: false, code: 'not_found' };
	}
	if (
		seat.role === 'owner'
		&& pilotActiveSeats(state).filter((row) => row.role === 'owner').length === 1
	) {
		return { ok: false, code: 'last_owner' };
	}
	const next: PilotRosterState = Object.freeze({
		rev: state.rev + 1,
		rosterSeq: state.rosterSeq + 1,
		seats: Object.freeze(
			state.seats.map((row) => (row === seat ? { ...row, removedAt: at } : row)),
		),
		consents: state.consents,
	});
	return {
		ok: true,
		state: next,
		rev: next.rev,
		stop: true,
		consent: null,
		participantId: null,
	};
}

function recordConsent(
	state: PilotRosterState,
	command: Extract<PilotRosterCommand, { kind: 'record-consent' }>,
): PilotRosterResult {
	if (
		!isId(command.actorId)
		|| !isId(command.participantId)
		|| !isPurpose(command.purpose)
		|| !isId(command.noticeVersion)
		|| !isTimestamp(command.at)
	) {
		return { ok: false, code: 'invalid_input' };
	}
	const seat = activeSeat(state, command.participantId);
	if (!seat) {
		return { ok: false, code: 'not_found' };
	}
	// Only the seat's own authenticated actor may acknowledge; no blanket consent.
	if (seat.actorId !== command.actorId) {
		return { ok: false, code: 'not_permitted' };
	}
	const finish = (row: PilotStoredConsent): PilotRosterResult => {
		const consents = Object.freeze([
			...state.consents.filter(
				(existing) =>
					existing.participantId !== row.participantId
					|| existing.purpose !== row.purpose,
			),
			row,
		]);
		const next: PilotRosterState = Object.freeze({
			rev: state.rev + 1,
			rosterSeq: state.rosterSeq,
			seats: state.seats,
			consents,
		});
		return {
			ok: true,
			state: next,
			rev: next.rev,
			stop: false,
			consent: row,
			participantId: null,
		};
	};
	const base = {
		rosterVersion: pilotRosterVersionOf(state),
		participantId: command.participantId,
		noticeVersion: command.noticeVersion,
		status: 'active',
		actorId: command.actorId,
		recordedAt: command.at,
		revokedAt: null,
	} as const;
	if (command.purpose === 'local-capture') {
		if (command.provider !== null || command.providerRevision !== null) {
			return { ok: false, code: 'invalid_input' };
		}
		return finish(Object.freeze({
			...base,
			purpose: 'local-capture',
			provider: null,
			providerRevision: null,
		}));
	}
	// External purposes must name the actual provider and its server revision.
	if (!isId(command.provider) || !isId(command.providerRevision)) {
		return { ok: false, code: 'invalid_input' };
	}
	return finish(Object.freeze({
		...base,
		purpose: command.purpose,
		provider: command.provider,
		providerRevision: command.providerRevision,
	}));
}

function revokeConsent(
	state: PilotRosterState,
	command: Extract<PilotRosterCommand, { kind: 'revoke-consent' }>,
): PilotRosterResult {
	const { actorId, participantId, purpose, at } = command;
	if (!isId(actorId) || !isId(participantId) || !isPurpose(purpose) || !isTimestamp(at)) {
		return { ok: false, code: 'invalid_input' };
	}
	const seat = activeSeat(state, participantId);
	if (!seat) {
		return { ok: false, code: 'not_found' };
	}
	if (seat.actorId !== actorId) {
		return { ok: false, code: 'not_permitted' };
	}
	const current = state.consents.find(
		(row) => row.participantId === participantId && row.purpose === purpose,
	);
	// Idempotent: already revoked (or never granted) still signals stop without a write.
	if (!current || current.status === 'revoked') {
		return {
			ok: true,
			state,
			rev: state.rev,
			stop: true,
			consent: null,
			participantId: null,
		};
	}
	const consents = Object.freeze(
		state.consents.map((row) =>
			row === current
				? Object.freeze({ ...row, status: 'revoked' as const, revokedAt: at })
				: row,
		),
	);
	const next: PilotRosterState = Object.freeze({
		rev: state.rev + 1,
		rosterSeq: state.rosterSeq,
		seats: state.seats,
		consents,
	});
	return {
		ok: true,
		state: next,
		rev: next.rev,
		stop: true,
		consent: null,
		participantId: null,
	};
}

/**
 * Apply one roster or consent mutation to the authoritative current state and
 * return the next durable state. The writer calls this inside its commit queue
 * and owns the revision comparison (skipped for safety commands).
 */
export function applyPilotRosterCommand(
	state: PilotRosterState,
	command: PilotRosterCommand,
): PilotRosterResult {
	switch (command.kind) {
		case 'add-seat':
			return addSeat(state, command);
		case 'remove-seat':
			return removeSeat(state, command);
		case 'record-consent':
			return recordConsent(state, command);
		case 'revoke-consent':
			return revokeConsent(state, command);
		default:
			return { ok: false, code: 'invalid_input' };
	}
}
