// Guests and snow-day drafts (SQLite, the app's source of truth; the Neon
// sync copies them one way). Every query is scoped to the signed-in owner.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../utils/env';
import { getDb, inTransaction } from '../utils/db';
import { newId } from '../utils/ids';
import { draftBody } from './messages';
import type { GuestLanguage } from './messages';

export type ReservationRow = {
	id: string;
	owner_id: string;
	guest_name: string;
	guest_country: string | null;
	language: GuestLanguage;
	contact: string | null;
	arrival_date: string;
	nights: number;
	arrives_by: string | null;
	is_sample: number;
	created_at: string;
};

export type MessageRow = {
	id: string;
	owner_id: string;
	reservation_id: string;
	purpose: 'snow_day';
	language: GuestLanguage;
	body: string;
	trigger: 'jma' | 'simulated';
	warning_code: string;
	status: 'draft' | 'approved' | 'sent' | 'discarded';
	created_at: string;
	approved_at: string | null;
	sent_at: string | null;
};

const INN_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // inns are in Japan (JST, no DST)

/** Inn-local calendar date (YYYY-MM-DD), optionally shifted by whole days. */
export function innDate(nowMs: number, plusDays = 0): string {
	return new Date(nowMs + INN_UTC_OFFSET_MS + plusDays * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

export function listArrivals(
	ownerId: string,
	from: string,
	to: string,
): ReservationRow[] {
	return getDb()
		.prepare(
			`SELECT * FROM guest_reservations
			 WHERE owner_id = ? AND arrival_date BETWEEN ? AND ?
			 ORDER BY arrival_date, created_at`,
		)
		.all(ownerId, from, to) as unknown as ReservationRow[];
}

export function listMessagesFor(
	ownerId: string,
	reservationIds: string[],
): MessageRow[] {
	if (reservationIds.length === 0) {
		return [];
	}
	const marks = reservationIds.map(() => '?').join(', ');
	return getDb()
		.prepare(
			`SELECT * FROM guest_messages
			 WHERE owner_id = ? AND reservation_id IN (${marks}) AND status <> 'discarded'
			 ORDER BY created_at`,
		)
		.all(ownerId, ...reservationIds) as unknown as MessageRow[];
}

export function findMessage(ownerId: string, id: string): MessageRow | null {
	return (
		(getDb()
			.prepare(
				'SELECT * FROM guest_messages WHERE id = ? AND owner_id = ?',
			)
			.get(id, ownerId) as unknown as MessageRow | undefined) ?? null
	);
}

export function findReservation(
	ownerId: string,
	id: string,
): ReservationRow | null {
	return (
		(getDb()
			.prepare(
				'SELECT * FROM guest_reservations WHERE id = ? AND owner_id = ?',
			)
			.get(id, ownerId) as unknown as ReservationRow | undefined) ?? null
	);
}

export type NewGuest = {
	guestName: string;
	guestCountry: string | null;
	language: GuestLanguage;
	contact: string | null;
	arrivalDate: string;
	nights: number;
	arrivesBy: string | null;
	isSample: boolean;
};

function insertGuest(
	db: ReturnType<typeof getDb>,
	ownerId: string,
	guest: NewGuest,
	now: string,
): string {
	const id = newId();
	db.prepare(
		`INSERT INTO guest_reservations
			(id, owner_id, guest_name, guest_country, language, contact, arrival_date,
			 nights, arrives_by, is_sample, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		id,
		ownerId,
		guest.guestName,
		guest.guestCountry,
		guest.language,
		guest.contact,
		guest.arrivalDate,
		guest.nights,
		guest.arrivesBy,
		guest.isSample ? 1 : 0,
		now,
	);
	return id;
}

export function addGuest(
	ownerId: string,
	guest: NewGuest,
	now: string,
): string {
	return inTransaction((db) => insertGuest(db, ownerId, guest, now));
}

/**
 * The four fictional sample guests (same people as the Neon demo branch):
 * two arriving today and two tomorrow, one per language. Replaces any
 * earlier sample guests (and their drafts) so the demo can be reset.
 */
export function loadSampleGuests(
	ownerId: string,
	today: string,
	tomorrow: string,
	now: string,
): number {
	const samples: NewGuest[] = [
		{
			guestName: '田中 美咲',
			guestCountry: 'Japan',
			language: 'ja',
			contact: 'tanaka@example.test',
			arrivalDate: today,
			nights: 2,
			arrivesBy: 'JR',
			isSample: true,
		},
		{
			guestName: 'Emily Carter',
			guestCountry: 'Australia',
			language: 'en',
			contact: 'emily@example.test',
			arrivalDate: today,
			nights: 3,
			arrivesBy: 'Rental car',
			isSample: true,
		},
		{
			guestName: '林 怡君',
			guestCountry: 'Taiwan',
			language: 'zh-TW',
			contact: 'LINE: lin-demo',
			arrivalDate: tomorrow,
			nights: 2,
			arrivesBy: 'Bus',
			isSample: true,
		},
		{
			guestName: '김민준',
			guestCountry: 'Korea',
			language: 'ko',
			contact: 'minjun@example.test',
			arrivalDate: tomorrow,
			nights: 1,
			arrivesBy: 'JR',
			isSample: true,
		},
	];
	return inTransaction((db) => {
		db.prepare(
			'DELETE FROM guest_reservations WHERE owner_id = ? AND is_sample = 1',
		).run(ownerId);
		for (const guest of samples) {
			insertGuest(db, ownerId, guest, now);
		}
		return samples.length;
	});
}

export type InnInfo = { innName: string; innPhone: string | null };

/**
 * One draft per guest arriving in [from, to] who has no open snow-day message
 * yet (draft/approved/sent). Returns how many drafts were created.
 */
export function createSnowDrafts(
	ownerId: string,
	inn: InnInfo,
	from: string,
	to: string,
	trigger: 'jma' | 'simulated',
	warningCode: string,
	now: string,
): number {
	return inTransaction((db) => {
		const guests = db
			.prepare(
				`SELECT r.* FROM guest_reservations r
				 WHERE r.owner_id = ? AND r.arrival_date BETWEEN ? AND ?
				   AND NOT EXISTS (
				     SELECT 1 FROM guest_messages m
				     WHERE m.reservation_id = r.id AND m.purpose = 'snow_day' AND m.status <> 'discarded')
				 ORDER BY r.arrival_date, r.created_at`,
			)
			.all(ownerId, from, to) as unknown as ReservationRow[];
		const insert = db.prepare(
			`INSERT INTO guest_messages
				(id, owner_id, reservation_id, purpose, language, body, trigger, warning_code, status, created_at)
			 VALUES (?, ?, ?, 'snow_day', ?, ?, ?, ?, 'draft', ?)`,
		);
		for (const guest of guests) {
			const body = draftBody(
				{
					guestName: guest.guest_name,
					...inn,
					arrivalDate: guest.arrival_date,
					warningCode,
				},
				guest.language,
			);
			insert.run(
				newId(),
				ownerId,
				guest.id,
				guest.language,
				body,
				trigger,
				warningCode,
				now,
			);
		}
		return guests.length;
	});
}

export function saveDraftBody(
	ownerId: string,
	id: string,
	body: string,
): boolean {
	const result = getDb()
		.prepare(
			`UPDATE guest_messages SET body = ? WHERE id = ? AND owner_id = ? AND status = 'draft'`,
		)
		.run(body, id, ownerId);
	return Number(result.changes) > 0;
}

export function approveMessage(
	ownerId: string,
	id: string,
	now: string,
): boolean {
	const result = getDb()
		.prepare(
			`UPDATE guest_messages SET status = 'approved', approved_at = ?
			 WHERE id = ? AND owner_id = ? AND status = 'draft'`,
		)
		.run(now, id, ownerId);
	return Number(result.changes) > 0;
}

export function discardMessage(ownerId: string, id: string): boolean {
	const result = getDb()
		.prepare(
			`UPDATE guest_messages SET status = 'discarded'
			 WHERE id = ? AND owner_id = ? AND status IN ('draft', 'approved')`,
		)
		.run(id, ownerId);
	return Number(result.changes) > 0;
}

/**
 * Sends an approved message. Demo delivery: the message is written to
 * ${DATA_DIR}/guest-outbox/<id>.txt and nothing leaves the machine (no LINE
 * or email integration yet). Only approved messages can be sent.
 */
export function sendMessage(ownerId: string, id: string, now: string): boolean {
	return inTransaction((db) => {
		const message = db
			.prepare(
				`SELECT * FROM guest_messages WHERE id = ? AND owner_id = ? AND status = 'approved'`,
			)
			.get(id, ownerId) as unknown as MessageRow | undefined;
		if (!message) {
			return false;
		}
		const guest = db
			.prepare('SELECT * FROM guest_reservations WHERE id = ?')
			.get(message.reservation_id) as unknown as
			ReservationRow | undefined;
		const dir = join(dataDir(), 'guest-outbox');
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `${message.id}.txt`),
			[
				`To: ${guest?.guest_name ?? ''}${guest?.contact ? ` <${guest.contact}>` : ''}`,
				`Language: ${message.language}`,
				`Approved: ${message.approved_at}`,
				`Sent: ${now}`,
				'X-Okami-Demo: local-guest-outbox',
				'',
				message.body,
			].join('\n'),
			'utf8',
		);
		db.prepare(
			`UPDATE guest_messages SET status = 'sent', sent_at = ? WHERE id = ?`,
		).run(now, id);
		return true;
	});
}
