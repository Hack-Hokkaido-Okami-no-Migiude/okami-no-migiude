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
			-- Nullable: voice-sourced reports carry voice_conversation_id instead.
			interview_id TEXT UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
			voice_conversation_id TEXT UNIQUE
				REFERENCES voice_sessions(conversation_id) ON DELETE CASCADE,
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
			-- Post-call assessment lifecycle: a second, transcript-informed
			-- Linkup deep pass (heaviest reasoning depth) followed by the Dify
			-- report and owner mail. Mirrors the research lifecycle: durable
			-- state on the row, boot recovery.
			assessment_status TEXT NOT NULL DEFAULT 'idle'
				CHECK (assessment_status IN ('idle', 'queued', 'running', 'completed', 'failed')),
			assessment_attempts INTEGER NOT NULL DEFAULT 0,
			assessment_after INTEGER,
			assessment_deadline INTEGER,
			assessment_report_id TEXT,
			assessment_research_status TEXT NOT NULL DEFAULT 'idle'
				CHECK (assessment_research_status IN ('idle', 'submitting', 'polling', 'completed', 'failed')),
			assessment_research_task_id TEXT,
			assessment_research_deadline INTEGER,
			assessment_research_poll_at INTEGER,
			assessment_research_cases TEXT,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_voice_sessions_owner ON voice_sessions(owner_id, created_at);
	`);
	migrateLegacySchema(db);
}

/**
 * Pre-assessment databases keep the old reports/voice_sessions shapes;
 * CREATE TABLE IF NOT EXISTS will not touch them. Bring those files forward:
 * voice_sessions gains plain ALTER'd columns, reports needs a NOT NULL drop
 * and therefore a table rebuild (report ids are preserved, so the
 * mail_outbox foreign keys stay valid).
 */
function migrateLegacySchema(db: DatabaseSync): void {
	const reportColumns = tableColumns(db, 'reports');
	if (reportColumns.size > 0 && !reportColumns.has('voice_conversation_id')) {
		db.exec('PRAGMA foreign_keys = OFF;');
		db.exec(`
			CREATE TABLE reports_new (
				id TEXT PRIMARY KEY,
				interview_id TEXT UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
				voice_conversation_id TEXT UNIQUE
					REFERENCES voice_sessions(conversation_id) ON DELETE CASCADE,
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
			INSERT INTO reports_new
				(id, interview_id, owner_id, business_name, locale, status, content,
				 failure_reason, consultation_requested_at, created_at, ready_at,
				 generate_attempts, generate_after)
			SELECT
				id, interview_id, owner_id, business_name, locale, status, content,
				failure_reason, consultation_requested_at, created_at, ready_at,
				generate_attempts, generate_after
			FROM reports;
			DROP TABLE reports;
			ALTER TABLE reports_new RENAME TO reports;
		`);
		db.exec(
			'CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports(status, generate_after);',
		);
		db.exec('PRAGMA foreign_keys = ON;');
	}
	const voiceColumns = tableColumns(db, 'voice_sessions');
	if (voiceColumns.size > 0 && !voiceColumns.has('assessment_status')) {
		db.exec(`
			ALTER TABLE voice_sessions ADD COLUMN assessment_status TEXT NOT NULL DEFAULT 'idle';
			ALTER TABLE voice_sessions ADD COLUMN assessment_attempts INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE voice_sessions ADD COLUMN assessment_after INTEGER;
			ALTER TABLE voice_sessions ADD COLUMN assessment_deadline INTEGER;
			ALTER TABLE voice_sessions ADD COLUMN assessment_report_id TEXT;
			ALTER TABLE voice_sessions ADD COLUMN assessment_research_status TEXT NOT NULL DEFAULT 'idle';
			ALTER TABLE voice_sessions ADD COLUMN assessment_research_task_id TEXT;
			ALTER TABLE voice_sessions ADD COLUMN assessment_research_deadline INTEGER;
			ALTER TABLE voice_sessions ADD COLUMN assessment_research_poll_at INTEGER;
			ALTER TABLE voice_sessions ADD COLUMN assessment_research_cases TEXT;
		`);
	}
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
		name: string;
	}[];
	return new Set(rows.map((row) => row.name));
}
