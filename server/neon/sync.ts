// One-way copy from the app's SQLite records into Neon (db/schema.sql).
//
// - Off unless NEON_DATABASE_URL is set; the app works the same without it.
// - Runs from the background worker at most every NEON_SYNC_INTERVAL_MS
//   (default 15s). Every pass upserts all owner profiles, submitted
//   interviews, voice transcripts and reports, so a missed pass is simply
//   caught up by the next one.
// - SQLite stays the app's source of truth. Nothing is ever read back.
// - Uses Neon's HTTP SQL endpoint (the same one @neondatabase/serverless
//   uses) through fetch, so no new dependency. One pass = one transaction.
// - Rows are marked is_synthetic unless NEON_REAL_DATA=true.
import { getDb } from '../utils/db';

type Param = string | number | null | undefined;
type Query = { query: string; params: Param[] };

let lastRunMs = 0;
let running = false;

export async function syncToNeonIfDue(): Promise<void> {
	const url = process.env.NEON_DATABASE_URL;
	if (!url || running) {
		return;
	}
	const interval = Number.parseInt(
		process.env.NEON_SYNC_INTERVAL_MS || '',
		10,
	);
	const everyMs =
		Number.isFinite(interval) && interval >= 1000 ? interval : 15000;
	if (Date.now() - lastRunMs < everyMs) {
		return;
	}
	lastRunMs = Date.now();
	running = true;
	try {
		const queries = buildSyncQueries(getDb());
		if (queries.length > 0) {
			await runNeonTransaction(url, queries);
		}
	} catch (error) {
		// Never let the copy break the app; the next pass retries.
		console.error(
			'[neon-sync] pass failed:',
			error instanceof Error ? error.message : error,
		);
	} finally {
		running = false;
	}
}

type Db = import('node:sqlite').DatabaseSync;

export function buildSyncQueries(db: Db): Query[] {
	const synthetic = process.env.NEON_REAL_DATA === 'true' ? 'false' : 'true';
	const retentionDays =
		Number.parseInt(process.env.NEON_RETENTION_DAYS || '', 10) || 90;
	const queries: Query[] = [];

	const owners = db
		.prepare(
			`SELECT u.id, u.email, p.name, p.business_name, p.business_type, p.other_business_type,
			        p.municipality, p.phone, p.website, p.locale
			 FROM users u JOIN owner_profiles p ON p.user_id = u.id
			 WHERE u.role = 'owner'`,
		)
		.all() as Record<string, string | null>[];
	for (const o of owners) {
		queries.push({
			query: `INSERT INTO inns (app_user_id, name, business_type, municipality, website_url,
			          owner_name, phone, email, language, is_synthetic)
			        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::boolean)
			        ON CONFLICT (app_user_id) DO UPDATE SET
			          name = EXCLUDED.name, business_type = EXCLUDED.business_type,
			          municipality = EXCLUDED.municipality, website_url = EXCLUDED.website_url,
			          owner_name = EXCLUDED.owner_name, phone = EXCLUDED.phone,
			          email = EXCLUDED.email, language = EXCLUDED.language`,
			params: [
				o.id,
				o.business_name,
				o.business_type === 'other' && o.other_business_type ?
					o.other_business_type
				:	o.business_type,
				o.municipality,
				o.website,
				o.name,
				o.phone,
				o.email,
				o.locale === 'en' ? 'en' : 'ja',
				synthetic,
			],
		});
	}

	// Scripted interviews: only once submitted, so the transcript is final.
	const interviews = db
		.prepare(
			`SELECT id, owner_id, consent_at, started_at, submitted_at, transcript
			 FROM interviews WHERE status = 'submitted'`,
		)
		.all() as Record<string, string | null>[];
	for (const i of interviews) {
		queries.push(
			interviewUpsert({
				appRef: i.id as string,
				ownerId: i.owner_id as string,
				mode: 'script',
				consentAt: i.consent_at as string,
				startedAt: i.started_at as string,
				submittedAt: i.submitted_at,
				transcript: i.transcript,
				researchCases: null,
				retentionDays,
				synthetic,
			}),
		);
	}

	// Voice chats: copied once the post-call transcript has arrived.
	const voices = db
		.prepare(
			`SELECT conversation_id, owner_id, consent_at, created_at, transcript, research_cases
			 FROM voice_sessions WHERE transcript IS NOT NULL`,
		)
		.all() as Record<string, string | null>[];
	for (const v of voices) {
		const consentAt = v.consent_at as string;
		const createdAt = v.created_at as string;
		queries.push(
			interviewUpsert({
				appRef: v.conversation_id as string,
				ownerId: v.owner_id as string,
				mode: 'voice',
				consentAt,
				startedAt: createdAt > consentAt ? createdAt : consentAt,
				submittedAt: null,
				transcript: v.transcript,
				researchCases: v.research_cases,
				retentionDays,
				synthetic,
			}),
		);
	}

	const reports = db
		.prepare(
			// Script reports point at interviews; voice reports (Dify assessment)
			// point at voice_sessions instead and have no interview_id. Both were
			// copied above as Neon interviews keyed by their app id.
			`SELECT r.id, COALESCE(r.interview_id, r.voice_conversation_id) AS interview_ref,
			        r.owner_id, r.locale, r.status, r.content, r.ready_at,
			        r.consultation_requested_at,
			        (SELECT MAX(m.sent_at) FROM mail_outbox m
			          WHERE m.report_id = r.id AND m.audience = 'owner' AND m.status = 'sent') AS sent_at
			 FROM reports r
			 LEFT JOIN interviews i ON i.id = r.interview_id
			 LEFT JOIN voice_sessions v ON v.conversation_id = r.voice_conversation_id
			 WHERE i.status = 'submitted' OR v.transcript IS NOT NULL`,
		)
		.all() as Record<string, string | null>[];
	for (const r of reports) {
		queries.push({
			query: `INSERT INTO reports (app_ref, interview_id, inn_id, language, status, content,
			          ready_at, consultation_requested_at, sent_at)
			        VALUES ($1, (SELECT id FROM interviews WHERE app_ref = $2),
			                (SELECT id FROM inns WHERE app_user_id = $3),
			                $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz)
			        ON CONFLICT (app_ref) DO UPDATE SET
			          status = EXCLUDED.status, content = EXCLUDED.content,
			          ready_at = EXCLUDED.ready_at,
			          consultation_requested_at = EXCLUDED.consultation_requested_at,
			          sent_at = EXCLUDED.sent_at`,
			params: [
				r.id,
				r.interview_ref,
				r.owner_id,
				r.locale === 'en' ? 'en' : 'ja',
				r.status,
				r.content,
				r.ready_at,
				r.consultation_requested_at,
				r.status === 'ready' ? r.sent_at : null,
			],
		});
	}

	// Snow-day flow: upcoming guests and the messages drafted for them.
	// Sample guests are always marked synthetic.
	const guests = db
		.prepare(
			`SELECT id, owner_id, guest_name, guest_country, language, contact, arrival_date,
			        nights, arrives_by, is_sample
			 FROM guest_reservations`,
		)
		.all() as Record<string, string | number | null>[];
	for (const g of guests) {
		queries.push({
			query: `INSERT INTO reservations (app_ref, inn_id, guest_name, guest_country, language,
			          contact, arrival_date, nights, arrives_by, is_synthetic)
			        VALUES ($1, (SELECT id FROM inns WHERE app_user_id = $2), $3, $4, $5, $6,
			                $7::date, $8::int, $9, $10::boolean)
			        ON CONFLICT (app_ref) DO UPDATE SET
			          guest_name = EXCLUDED.guest_name, guest_country = EXCLUDED.guest_country,
			          language = EXCLUDED.language, contact = EXCLUDED.contact,
			          arrival_date = EXCLUDED.arrival_date, nights = EXCLUDED.nights,
			          arrives_by = EXCLUDED.arrives_by`,
			params: [
				g.id,
				g.owner_id,
				g.guest_name,
				g.guest_country,
				g.language,
				g.contact,
				g.arrival_date,
				g.nights,
				g.arrives_by,
				g.is_sample === 1 ? 'true' : synthetic,
			],
		});
	}

	const messages = db
		.prepare(
			`SELECT id, owner_id, reservation_id, purpose, language, body, status,
			        created_at, approved_at, sent_at
			 FROM guest_messages`,
		)
		.all() as Record<string, string | null>[];
	for (const m of messages) {
		queries.push({
			query: `INSERT INTO message_drafts (app_ref, inn_id, reservation_id, purpose, language,
			          body, status, created_at, approved_at, sent_at)
			        VALUES ($1, (SELECT id FROM inns WHERE app_user_id = $2),
			                (SELECT id FROM reservations WHERE app_ref = $3), $4, $5, $6, $7,
			                $8::timestamptz, $9::timestamptz, $10::timestamptz)
			        ON CONFLICT (app_ref) DO UPDATE SET
			          body = EXCLUDED.body, status = EXCLUDED.status,
			          approved_at = EXCLUDED.approved_at, sent_at = EXCLUDED.sent_at`,
			params: [
				m.id,
				m.owner_id,
				m.reservation_id,
				m.purpose,
				m.language,
				m.body,
				m.status,
				m.created_at,
				m.approved_at,
				m.sent_at,
			],
		});
	}

	return queries;
}

function interviewUpsert(i: {
	appRef: string;
	ownerId: string;
	mode: 'script' | 'voice';
	consentAt: string;
	startedAt: string;
	submittedAt: string | null | undefined;
	transcript: string | null | undefined;
	researchCases: string | null | undefined;
	retentionDays: number;
	synthetic: string;
}): Query {
	return {
		query: `INSERT INTO interviews (app_ref, inn_id, mode, consent_at, started_at, submitted_at,
		          transcript, research_cases, delete_after, is_synthetic)
		        VALUES ($1, (SELECT id FROM inns WHERE app_user_id = $2), $3,
		                $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::text, $8::jsonb,
		                CASE WHEN $7::text IS NULL THEN NULL
		                     ELSE ($5::timestamptz)::date + $9::int END,
		                $10::boolean)
		        ON CONFLICT (app_ref) DO UPDATE SET
		          submitted_at = EXCLUDED.submitted_at, transcript = EXCLUDED.transcript,
		          research_cases = EXCLUDED.research_cases,
		          delete_after = COALESCE(interviews.delete_after, EXCLUDED.delete_after)`,
		params: [
			i.appRef,
			i.ownerId,
			i.mode,
			i.consentAt,
			i.startedAt,
			i.submittedAt,
			i.transcript,
			validJson(i.researchCases),
			i.retentionDays,
			i.synthetic,
		],
	};
}

function validJson(text: string | null | undefined): string | null {
	if (!text) {
		return null;
	}
	try {
		JSON.parse(text);
		return text;
	} catch {
		return null;
	}
}

// Neon's SQL-over-HTTP endpoint: https://api.<region host>/sql, with the
// connection string in a header. A body of {queries: [...]} runs them in one
// transaction.
export async function runNeonTransaction(
	connectionString: string,
	queries: Query[],
): Promise<void> {
	const host = new URL(connectionString).hostname;
	const endpoint = `https://${host.replace(/^[^.]+\./, 'api.')}/sql`;
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Neon-Connection-String': connectionString,
			'Neon-Raw-Text-Output': 'true',
			'Neon-Array-Mode': 'true',
		},
		body: JSON.stringify({ queries }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Neon HTTP ${response.status}: ${text.slice(0, 300)}`);
	}
}
