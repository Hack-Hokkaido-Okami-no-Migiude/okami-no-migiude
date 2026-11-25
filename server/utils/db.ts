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
			-- The conversation minted for this interview (POST
			-- /api/voice/sessions). The post-call webhook falls back to it
			-- when the client could not pass the interview id as a dynamic
			-- variable. Nullable: demo rows and interviews minted before the
			-- association existed have none.
			conversation_id TEXT,
			-- Live-agent lifecycle (mode 'live'): background research over the
			-- owner's profile intake plus the post-call Dify assessment. Both
			-- are durable state on the row (same pattern as voice_sessions),
			-- so boot recovery is inherent. Demo rows keep everything idle.
			business_json TEXT,
			report_language TEXT,
			research_status TEXT NOT NULL DEFAULT 'idle'
				CHECK (research_status IN ('idle', 'queued', 'submitting', 'polling', 'completed', 'failed')),
			research_task_id TEXT,
			research_deadline INTEGER,
			research_poll_at INTEGER,
			research_cases TEXT,
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
			-- What produced the content: the rule-based demo analyzer or the
			-- Dify post-call assessment. Drives the honest page label.
			generator TEXT NOT NULL DEFAULT 'rule_based'
				CHECK (generator IN ('rule_based', 'dify')),
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
			provider TEXT NOT NULL CHECK (provider IN ('local', 'resend')),
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
		-- Snow-day flow: the inn's upcoming guests and the messages drafted
		-- for them. A draft is only ever sent after the owner approved it.
		CREATE TABLE IF NOT EXISTS guest_reservations (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			guest_name TEXT NOT NULL,
			guest_country TEXT,
			language TEXT NOT NULL CHECK (language IN ('ja', 'en', 'zh-TW', 'ko')),
			contact TEXT,
			arrival_date TEXT NOT NULL,
			nights INTEGER NOT NULL DEFAULT 1 CHECK (nights > 0),
			arrives_by TEXT,
			is_sample INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_guest_reservations_owner ON guest_reservations(owner_id, arrival_date);
		CREATE TABLE IF NOT EXISTS guest_messages (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			reservation_id TEXT NOT NULL REFERENCES guest_reservations(id) ON DELETE CASCADE,
			purpose TEXT NOT NULL CHECK (purpose IN ('snow_day')),
			language TEXT NOT NULL,
			body TEXT NOT NULL,
			trigger TEXT NOT NULL CHECK (trigger IN ('jma', 'simulated')),
			warning_code TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sent', 'discarded')),
			created_at TEXT NOT NULL,
			approved_at TEXT,
			sent_at TEXT,
			CHECK (status NOT IN ('approved', 'sent') OR approved_at IS NOT NULL),
			CHECK (status <> 'sent' OR sent_at IS NOT NULL)
		);
		CREATE INDEX IF NOT EXISTS idx_guest_messages_owner ON guest_messages(owner_id, status);
	`);
	migrateLegacySchema(db);
	// Created after the legacy migration so the index covers fresh and
	// migrated schemas alike: the conversation_id column may have just been
	// added to a pre-migration interviews table by ALTER TABLE above.
	db.exec(
		'CREATE INDEX IF NOT EXISTS idx_interviews_conversation ON interviews(conversation_id);',
	);
}

/**
 * Pre-assessment databases keep the old reports/voice_sessions shapes;
 * CREATE TABLE IF NOT EXISTS will not touch them. Bring those files forward:
 * voice_sessions gains plain ALTER'd columns, reports needs a NOT NULL drop
 * and therefore a table rebuild (report ids are preserved, so the
 * mail_outbox foreign keys stay valid), and pre-Resend mail_outbox tables
 * carry the legacy 'smtp' provider slot and also need a rebuild — legacy
 * 'smtp' rows map to 'resend', the only live provider.
 */
function migrateLegacySchema(db: DatabaseSync): void {
	// Legacy mail_outbox tables still declare the 'smtp' CHECK slot; detect
	// them from the stored CREATE statement, which the fresh schema never has.
	const mailTableSql = (
		db
			.prepare(
				"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mail_outbox'",
			)
			.get() as unknown as { sql: string } | undefined
	)?.sql;
	if (mailTableSql && mailTableSql.includes(`'smtp'`)) {
		db.exec('PRAGMA foreign_keys = OFF;');
		db.exec(`
			CREATE TABLE mail_outbox_new (
				id TEXT PRIMARY KEY,
				report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
				audience TEXT NOT NULL CHECK (audience IN ('owner', 'staff')),
				recipient TEXT NOT NULL,
				subject TEXT NOT NULL,
				body TEXT NOT NULL,
				provider TEXT NOT NULL CHECK (provider IN ('local', 'resend')),
				status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
				attempts INTEGER NOT NULL DEFAULT 0,
				last_error TEXT,
				next_attempt_at INTEGER,
				created_at TEXT NOT NULL,
				sent_at TEXT,
				UNIQUE (report_id, audience, recipient)
			);
			INSERT INTO mail_outbox_new
				(id, report_id, audience, recipient, subject, body, provider,
				 status, attempts, last_error, next_attempt_at, created_at, sent_at)
			SELECT
				id, report_id, audience, recipient, subject, body, 'resend',
				status, attempts, last_error, next_attempt_at, created_at, sent_at
			FROM mail_outbox;
			DROP TABLE mail_outbox;
			ALTER TABLE mail_outbox_new RENAME TO mail_outbox;
		`);
		db.exec(
			'CREATE INDEX IF NOT EXISTS idx_mail_queued ON mail_outbox(status, next_attempt_at);',
		);
		db.exec('PRAGMA foreign_keys = ON;');
	}
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
				generator TEXT NOT NULL DEFAULT 'rule_based'
					CHECK (generator IN ('rule_based', 'dify')),
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
	// Legacy reports tables predate the generator column; everything produced
	// before the Dify assessment was rule-based demo output, so the default
	// label is the honest migration for existing rows.
	if (reportColumns.size > 0 && !reportColumns.has('generator')) {
		db.exec(
			"ALTER TABLE reports ADD COLUMN generator TEXT NOT NULL DEFAULT 'rule_based'",
		);
	}
	// Legacy interviews tables predate the live-agent lifecycle columns; demo
	// rows never used them, so the idle defaults are the correct migration.
	const interviewColumns = tableColumns(db, 'interviews');
	if (interviewColumns.size > 0 && !interviewColumns.has('research_status')) {
		db.exec(`
			ALTER TABLE interviews ADD COLUMN business_json TEXT;
			ALTER TABLE interviews ADD COLUMN report_language TEXT;
			ALTER TABLE interviews ADD COLUMN research_status TEXT NOT NULL DEFAULT 'idle';
			ALTER TABLE interviews ADD COLUMN research_task_id TEXT;
			ALTER TABLE interviews ADD COLUMN research_deadline INTEGER;
			ALTER TABLE interviews ADD COLUMN research_poll_at INTEGER;
			ALTER TABLE interviews ADD COLUMN research_cases TEXT;
			ALTER TABLE interviews ADD COLUMN assessment_status TEXT NOT NULL DEFAULT 'idle';
			ALTER TABLE interviews ADD COLUMN assessment_attempts INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE interviews ADD COLUMN assessment_after INTEGER;
			ALTER TABLE interviews ADD COLUMN assessment_deadline INTEGER;
			ALTER TABLE interviews ADD COLUMN assessment_report_id TEXT;
			ALTER TABLE interviews ADD COLUMN assessment_research_status TEXT NOT NULL DEFAULT 'idle';
			ALTER TABLE interviews ADD COLUMN assessment_research_task_id TEXT;
			ALTER TABLE interviews ADD COLUMN assessment_research_deadline INTEGER;
			ALTER TABLE interviews ADD COLUMN assessment_research_poll_at INTEGER;
			ALTER TABLE interviews ADD COLUMN assessment_research_cases TEXT;
		`);
	}
	// Legacy interviews tables predate the minted-conversation association;
	// the column is nullable and stays NULL for rows minted before it
	// existed (their conversations cannot be back-resolved).
	if (interviewColumns.size > 0 && !interviewColumns.has('conversation_id')) {
		db.exec('ALTER TABLE interviews ADD COLUMN conversation_id TEXT;');
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
