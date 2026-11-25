// SQLite via node:sqlite (built into Node 26, zero dependencies). One process,
// one connection; the approved override replaces the generic jobs table with
// durable pending state on the `reports` rows plus a keyed `mail_outbox`.
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './env';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

type DbGlobal = typeof globalThis & { __okamiDb?: DatabaseSync };

export function getDb(): DatabaseSync {
	const global = globalThis as DbGlobal;
	if (!global.__okamiDb) {
		const dir = dataDir();
		mkdirSync(dir, { recursive: true });
		const db = new DatabaseSync(join(dir, 'app.db'));
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA foreign_keys = ON;');
		initSchema(db);
		global.__okamiDb = db;
	}
	return global.__okamiDb;
}

/**
 * Serializes work inside a single BEGIN IMMEDIATE transaction. Because the
 * queue is state-based (pending report rows / queued outbox rows), a crash
 * between submit and ready simply leaves the row pending; the next worker
 * tick (or boot) picks it up again. Recovery is therefore inherent.
 */
export function inTransaction<T>(work: (db: DatabaseSync) => T): T {
	const db = getDb();
	db.exec('BEGIN IMMEDIATE');
	try {
		const result = work(db);
		db.exec('COMMIT');
		return result;
	} catch (error) {
		try {
			db.exec('ROLLBACK');
		} catch {
			// Transaction was already rolled back or never opened.
		}
		throw error;
	}
}

function initSchema(db: DatabaseSync): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS owner_profiles (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			business_name TEXT NOT NULL,
			business_type TEXT NOT NULL,
			other_business_type TEXT,
			municipality TEXT NOT NULL,
			phone TEXT,
			website TEXT,
			note TEXT,
			locale TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS interviews (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
			status TEXT NOT NULL CHECK (status IN ('active', 'submitted')),
			consent_at TEXT NOT NULL,
			started_at TEXT NOT NULL,
			deadline_at TEXT NOT NULL,
			submitted_at TEXT,
			transcript TEXT,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_interviews_owner ON interviews(owner_id, status);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_owner_submitted ON interviews(owner_id) WHERE status = 'submitted';
		CREATE TABLE IF NOT EXISTS reports (
			id TEXT PRIMARY KEY,
			interview_id TEXT NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			business_name TEXT NOT NULL,
			locale TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
			content TEXT,
			failure_reason TEXT,
			consultation_requested_at TEXT,
			created_at TEXT NOT NULL,
			ready_at TEXT,
			generate_attempts INTEGER NOT NULL DEFAULT 0,
			generate_after INTEGER
		);
		CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports(status, generate_after);
		CREATE TABLE IF NOT EXISTS mail_outbox (
			id TEXT PRIMARY KEY,
			report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
			audience TEXT NOT NULL CHECK (audience IN ('owner', 'staff')),
			recipient TEXT NOT NULL,
			subject TEXT NOT NULL,
			body TEXT NOT NULL,
			provider TEXT NOT NULL CHECK (provider IN ('local', 'smtp')),
			status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT,
			next_attempt_at INTEGER,
			created_at TEXT NOT NULL,
			sent_at TEXT,
			UNIQUE (report_id, audience, recipient)
		);
		CREATE INDEX IF NOT EXISTS idx_mail_queued ON mail_outbox(status, next_attempt_at);
		CREATE TABLE IF NOT EXISTS voice_sessions (
			conversation_id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			consent_at TEXT NOT NULL,
			report_language TEXT NOT NULL CHECK (report_language IN ('ja', 'en')),
			business TEXT,
			research_status TEXT NOT NULL DEFAULT 'idle'
				CHECK (research_status IN ('idle', 'queued', 'submitting', 'polling', 'completed', 'failed')),
			research_task_id TEXT,
			research_deadline INTEGER,
			research_poll_at INTEGER,
			research_cases TEXT,
			transcript TEXT,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_voice_sessions_owner ON voice_sessions(owner_id, created_at);
	`);
}
