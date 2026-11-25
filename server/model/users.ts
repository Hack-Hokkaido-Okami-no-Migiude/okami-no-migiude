// User/profile/session-row access plus SessionUser shaping.
import type {
	BusinessType,
	Locale,
	OwnerProfile,
	SessionUser,
} from '#shared/types/domain';
import { getDb, inTransaction } from '../utils/db';
import { hashPassword } from '../utils/password';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/clock';

export type SignupInput = {
	email: string;
	password: string;
	name: string;
	businessName: string;
	businessType: BusinessType;
	otherBusinessType: string | null;
	municipality: string;
	phone: string | null;
	website: string | null;
	note: string | null;
	locale: Locale;
};

export type UserRow = {
	id: string;
	email: string;
	password_hash: string;
	role: 'owner' | 'staff';
	created_at: string;
};

export type SessionUserLookup = {
	expiresAt: string;
	sessionUser: SessionUser;
};

const SESSION_SELECT = `
	SELECT s.expires_at AS expires_at, u.id AS id, u.email AS email, u.role AS role,
	       p.name AS name, p.business_name AS business_name, p.business_type AS business_type,
	       p.other_business_type AS other_business_type, p.municipality AS municipality,
	       p.phone AS phone, p.website AS website, p.note AS note, p.locale AS locale
	FROM sessions s
	JOIN users u ON u.id = s.user_id
	LEFT JOIN owner_profiles p ON p.user_id = u.id
`;

export function findUserByEmail(email: string): UserRow | undefined {
	return getDb()
		.prepare('SELECT * FROM users WHERE email = ?')
		.get(email) as unknown as UserRow | undefined;
}

export function createOwnerUser(input: SignupInput): string {
	const userId = newId();
	const createdAt = nowIso();
	inTransaction((db) => {
		db.prepare(
			'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
		).run(
			userId,
			input.email,
			hashPassword(input.password),
			'owner',
			createdAt,
		);
		db.prepare(
			`INSERT INTO owner_profiles
				(user_id, name, business_name, business_type, other_business_type, municipality, phone, website, note, locale)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			userId,
			input.name,
			input.businessName,
			input.businessType,
			input.otherBusinessType,
			input.municipality,
			input.phone,
			input.website,
			input.note,
			input.locale,
		);
	});
	return userId;
}

/** Idempotent boot-time staff provisioning (§7). */
export function provisionStaffUsers(emails: string[], password: string): void {
	const roster = new Set(emails);
	inTransaction((db) => {
		for (const email of listStaffEmails()) {
			if (roster.has(email)) {
				continue;
			}
			db.prepare(
				"DELETE FROM mail_outbox WHERE audience = 'staff' AND recipient = ? AND status = 'queued'",
			).run(email);
			db.prepare(
				"DELETE FROM users WHERE role = 'staff' AND email = ?",
			).run(email);
		}
	});
	if (emails.length === 0) {
		return;
	}
	if (!password) {
		console.warn(
			'[boot] STAFF_EMAILS is set but STAFF_PASSWORD is empty; staff provisioning skipped',
		);
		return;
	}
	const db = getDb();
	for (const email of emails) {
		const existing = db
			.prepare('SELECT role FROM users WHERE email = ?')
			.get(email);
		if (existing) {
			if (existing.role === 'owner') {
				console.warn(
					'[boot] Staff roster conflicts with an existing owner account',
				);
			}
			continue;
		}
		db.prepare(
			'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
		).run(newId(), email, hashPassword(password), 'staff', nowIso());
	}
}

export function listStaffEmails(): string[] {
	return (
		getDb()
			.prepare(
				"SELECT email FROM users WHERE role = 'staff' ORDER BY email",
			)
			.all() as unknown as { email: string }[]
	).map((row) => row.email);
}

export function loadSessionUserByTokenHash(
	tokenHash: string,
): SessionUserLookup | null {
	const row = getDb()
		.prepare(`${SESSION_SELECT} WHERE s.token_hash = ?`)
		.get(tokenHash) as unknown as
		(RowWithProfile & { expires_at: string }) | undefined;
	if (!row) {
		return null;
	}
	return { expiresAt: row.expires_at, sessionUser: shapeSessionUser(row) };
}

export function loadSessionUserById(userId: string): SessionUser | null {
	const row = getDb()
		.prepare(
			`SELECT u.id AS id, u.email AS email, u.role AS role,
			        p.name AS name, p.business_name AS business_name, p.business_type AS business_type,
			        p.other_business_type AS other_business_type, p.municipality AS municipality,
			        p.phone AS phone, p.website AS website, p.note AS note, p.locale AS locale
			 FROM users u
			 LEFT JOIN owner_profiles p ON p.user_id = u.id
			 WHERE u.id = ?`,
		)
		.get(userId) as unknown as RowWithProfile | undefined;
	if (!row) {
		return null;
	}
	return shapeSessionUser(row);
}

type RowWithProfile = {
	id: string;
	email: string;
	role: 'owner' | 'staff';
	name: string | null;
	business_name: string | null;
	business_type: string | null;
	other_business_type: string | null;
	municipality: string | null;
	phone: string | null;
	website: string | null;
	note: string | null;
	locale: string | null;
};

function shapeSessionUser(row: RowWithProfile): SessionUser {
	if (row.role === 'owner') {
		const profile: OwnerProfile = {
			name: row.name ?? '',
			email: row.email,
			businessName: row.business_name ?? '',
			businessType: (row.business_type ?? 'other') as BusinessType,
			otherBusinessType: row.other_business_type,
			municipality: row.municipality ?? '',
			phone: row.phone,
			website: row.website,
			note: row.note,
			locale: (row.locale ?? 'ja') as Locale,
		};
		return { id: row.id, role: 'owner', profile };
	}
	return {
		id: row.id,
		role: 'staff',
		profile: {
			name: row.email.split('@')[0] || row.email,
			email: row.email,
		},
	};
}
