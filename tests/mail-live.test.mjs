// Mail delivery tests for the report-ready outbox (§9):
//
// 1. Default (no MAIL_RESEND_API_KEY): delivery remains the local .eml
//    outbox — no external mail is sent and the stub endpoint receives zero
//    requests.
// 2. Live gate: MAIL_RESEND_API_KEY + loopback stub base URL — the idempotent
//    live sender delivers every queued mail as one idempotent REST call (stable
//    Idempotency-Key = outbox mail id), the local .eml path stays untouched,
//    a failed attempt is retried with the SAME stable key, and no secret or
//    PII ever reaches the server logs.
//
// Run against a real built Nitro server on an isolated localhost port:
//   npm run build
//   node --test tests/mail-live.test.mjs
//
// The "provider" is a loopback HTTP stub (the documented QA substitute for the
// Resend REST API); no real third-party endpoint is ever contacted and the key
// below is a fictional fixture, not a secret.

import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');
const serverEntry = path.join(repoRoot, '.output', 'server', 'index.mjs');

const STAFF_EMAIL = 'staff-mail@example.test';
const STAFF_PASSWORD = 'test-staff-password-1234';
const MAIL_FROM = 'qa-stub@example.test';
const STUB_KEY = 'qa-stub-fixture-key-not-a-secret';

const OWNER = {
	email: 'owner-mail@example.test',
	password: 'owner-mail-pass-1234',
	profile: {
		name: 'Mail 経営子',
		businessName: 'ローカル宿 pretender',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};

const TRANSCRIPT = [
	'面接者: 事業の現状を教えてください。',
	'経営者: 客室は12室ありますが、清掃スタッフが足りません。',
	'面接者: 本日はありがとうございました。',
].join('\n');

// The mail must never carry transcript content — only subject and report link.
const TRANSCRIPT_EXCERPT = '客室は12室あります';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const testsDataRoot = path.join(repoRoot, '.data', 'test');

function newDataDir(label) {
	const dir = path.join(testsDataRoot, `${label}-${process.pid}`);
	fs.rmSync(dir, { recursive: true, force: true });
	return dir;
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = http.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => {
				resolve(port);
			});
		});
	});
}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function newCookieJar() {
	const jar = { map: new Map() };
	jar.capture = (response) => {
		for (const line of response.headers.getSetCookie()) {
			const pair = line.split(';')[0];
			const eq = pair.indexOf('=');
			if (eq > 0) {
				jar.map.set(
					pair.slice(0, eq).trim(),
					pair.slice(eq + 1).trim(),
				);
			}
		}
	};
	jar.header = () =>
		[...jar.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
	return jar;
}

async function request(baseUrl, method, pathName, options = {}) {
	const headers = { ...(options.headers || {}) };
	if (options.jar && options.jar.map.size > 0) {
		headers.cookie = options.jar.header();
	}
	let body;
	if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers['content-type'] = 'application/json';
	}
	if (options.origin !== null) {
		headers.origin = options.origin ?? baseUrl;
	}
	const response = await fetch(`${baseUrl}${pathName}`, {
		method,
		headers,
		body,
		redirect: 'manual',
	});
	if (options.jar) {
		options.jar.capture(response);
	}
	const text = await response.text();
	let json = null;
	try {
		json = text.length > 0 ? JSON.parse(text) : null;
	} catch {
		// Non-JSON body (e.g. the markdown attachment) stays null.
	}
	return { status: response.status, headers: response.headers, json, text };
}

function expectStatus(step, response, status) {
	assert.equal(
		response.status,
		status,
		`${step}: expected HTTP ${status}, got ${response.status} (${response.text.slice(0, 300)})`,
	);
}

async function pollUntil(label, fn, timeoutMs = 20000, intervalMs = 200) {
	const startedAt = Date.now();
	let lastError = null;
	for (;;) {
		try {
			const value = await fn();
			if (value) {
				return value;
			}
		} catch (error) {
			lastError = error;
		}
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(
				`pollUntil timed out after ${timeoutMs}ms: ${label}${lastError ? ` (last error: ${lastError.message})` : ''}`,
			);
		}
		await sleep(intervalMs);
	}
}

function withDb(dataDir, fn) {
	const db = new DatabaseSync(path.join(dataDir, 'app.db'));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function mailRows(dataDir) {
	return withDb(dataDir, (db) =>
		db
			.prepare(
				'SELECT id, report_id, audience, recipient, subject, body, provider, status, attempts, last_error, created_at, sent_at FROM mail_outbox ORDER BY created_at',
			)
			.all(),
	);
}

/**
 * Loopback stand-in for the Resend REST API. Records every request and can be
 * told to fail the next attempt for a given idempotency key.
 */
async function startMailStub() {
	const requests = [];
	const failNextByKey = new Map();
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			const record = {
				path: req.url,
				method: req.method,
				idempotencyKey: req.headers['idempotency-key'] ?? null,
				body: raw.length > 0 ? JSON.parse(raw) : null,
			};
			record.authorization = req.headers.authorization ?? null;
			requests.push(record);
			const failureStatus = failNextByKey.get(record.idempotencyKey);
			if (failureStatus) {
				failNextByKey.delete(record.idempotencyKey);
				res.writeHead(failureStatus, {
					'content-type': 'application/json',
				});
				res.end(JSON.stringify({ message: 'stub injected failure' }));
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ id: `stub-${requests.length}` }));
		});
	});
	await new Promise((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const port = server.address().port;
	return {
		port,
		requests,
		failNextByKey,
		close: async () => {
			server.closeAllConnections?.();
			await new Promise((resolve) => {
				server.close(resolve);
			});
		},
	};
}

async function startServer(label, dataDir, extraEnv = {}) {
	const port = await freePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, [serverEntry], {
		cwd: repoRoot,
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			PUBLIC_BASE_URL: baseUrl,
			STAFF_EMAILS: STAFF_EMAIL,
			STAFF_PASSWORD: STAFF_PASSWORD,
			MAIL_FROM: MAIL_FROM,
			WORKER_POLL_MS: '500',
			...extraEnv,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const logChunks = [];
	child.stdout.on('data', (chunk) => logChunks.push(chunk));
	child.stderr.on('data', (chunk) => logChunks.push(chunk));
	await pollUntil(`${label} ready`, async () => {
		const probe = await request(baseUrl, 'GET', '/', { origin: null });
		return probe.status === 200;
	});
	return {
		port,
		baseUrl,
		close: async () => {
			child.kill();
			await pollUntil(`${label} exit`, async () => {
				return child.exitCode !== null || child.signalCode !== null;
			});
		},
		logs: () => Buffer.concat(logChunks).toString('utf8'),
	};
}

async function runOwnerJourney(baseUrl) {
	const jar = newCookieJar();
	expectStatus(
		'signup',
		await request(baseUrl, 'POST', '/api/auth/signup', {
			jar,
			body: OWNER,
		}),
		201,
	);
	const start = await request(baseUrl, 'POST', '/api/interviews/start', {
		jar,
		body: { consent: true, mode: 'demo' },
	});
	expectStatus('start', start, 201);
	const complete = await request(
		baseUrl,
		'POST',
		`/api/interviews/${start.json.interview.id}/complete`,
		{ jar, body: { transcript: TRANSCRIPT } },
	);
	expectStatus('complete', complete, 200);
	const reportId = complete.json.reportId;
	await pollUntil('report ready', async () => {
		const response = await request(
			baseUrl,
			'GET',
			`/api/reports/${reportId}`,
			{ jar, origin: null },
		);
		expectStatus('report detail', response, 200);
		return response.json.report.status === 'ready' ? response : null;
	});
	return reportId;
}

function emlFiles(dataDir) {
	const dir = path.join(dataDir, 'mail-outbox');
	return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

test(
	'mail: without an API key the local .eml outbox delivers with zero external calls',
	{ timeout: 120000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const stub = await startMailStub();
		const dataDir = newDataDir('mail-gate-off');
		let server = null;
		try {
			// No MAIL_RESEND_API_KEY: Resend is never contacted and the local
			// outbox keeps working untouched.
			server = await startServer('gate-off server', dataDir, {
				MAIL_RESEND_BASE_URL: `http://127.0.0.1:${stub.port}`,
			});
			await runOwnerJourney(server.baseUrl);
			await pollUntil('gate-off .eml files', async () => {
				return emlFiles(dataDir).length === 2 ?
						emlFiles(dataDir)
					:	null;
			});
			assert.deepEqual(stub.requests, [], 'no external mail calls');
			const rows = mailRows(dataDir);
			assert.equal(rows.length, 2);
			for (const row of rows) {
				assert.equal(row.provider, 'local');
				assert.equal(row.status, 'sent');
				assert.match(row.sent_at, ISO_RE);
			}
			const ownerRow = rows.find((row) => row.audience === 'owner');
			const eml = fs.readFileSync(
				path.join(dataDir, 'mail-outbox', `${ownerRow.id}.eml`),
				'utf8',
			);
			assert.match(eml, new RegExp(`^To: ${ownerRow.recipient}$`, 'm'));
			assert.ok(eml.includes(ownerRow.subject));
			assert.ok(eml.includes(ownerRow.body));
		} finally {
			if (server) {
				await server.close();
			}
			await stub.close();
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	},
);

test(
	'mail: live resend sender delivers idempotently, retries with the same key, and never logs secrets',
	{ timeout: 120000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const stub = await startMailStub();
		const dataDir = newDataDir('mail-live');
		let server = null;
		try {
			server = await startServer('live server', dataDir, {
				MAIL_RESEND_API_KEY: STUB_KEY,
				MAIL_RESEND_BASE_URL: `http://127.0.0.1:${stub.port}`,
			});
			const reportId = await runOwnerJourney(server.baseUrl);
			await pollUntil('live deliveries arrive and settle', async () => {
				const rows = mailRows(dataDir);
				return (
						rows.length === 2
							&& rows.every((row) => row.status === 'sent')
							&& stub.requests.length >= 2
					) ?
						rows
					:	null;
			});

			const rows = mailRows(dataDir);
			assert.equal(rows.length, 2, 'one owner mail + one staff mail');
			const byId = new Map(rows.map((row) => [row.id, row]));
			for (const row of rows) {
				assert.equal(row.status, 'sent');
				assert.equal(
					row.provider,
					'resend',
					'the live provider slot records the Resend delivery',
				);
				assert.match(row.sent_at, ISO_RE);
			}
			assert.equal(emlFiles(dataDir).length, 0, 'no .eml in live mode');

			const audiences = rows.map((row) => row.audience).sort();
			assert.deepEqual(audiences, ['owner', 'staff']);
			const ownerRow = rows.find((row) => row.audience === 'owner');
			assert.equal(ownerRow.recipient, OWNER.email.toLowerCase());
			const staffRow = rows.find((row) => row.audience === 'staff');
			assert.equal(staffRow.recipient, STAFF_EMAIL);

			for (const record of stub.requests) {
				assert.equal(record.method, 'POST');
				assert.equal(record.path, '/emails');
				assert.equal(
					record.authorization,
					`Bearer ${STUB_KEY}`,
					'the stub sees only the configured key',
				);
				assert.ok(
					byId.has(record.idempotencyKey),
					'idempotency key must be the stable outbox mail id',
				);
				const row = byId.get(record.idempotencyKey);
				assert.equal(record.body.to, row.recipient);
				assert.equal(record.body.subject, row.subject);
				assert.equal(record.body.text, row.body);
				assert.equal(record.body.from, MAIL_FROM);
				assert.ok(
					row.body.includes(`${server.baseUrl}/reports/${reportId}`),
					'mail body carries the absolute protected report link',
				);
				assert.doesNotMatch(
					record.body.text,
					new RegExp(TRANSCRIPT_EXCERPT),
					'mail must never carry transcript content',
				);
			}
			const staffRecord = stub.requests.find(
				(record) => record.body.to === STAFF_EMAIL,
			);
			assert.ok(
				staffRecord.body.text.includes(OWNER.profile.name),
				'staff mail names the owner',
			);

			const logs = server.logs();
			assert.doesNotMatch(
				logs,
				new RegExp(STUB_KEY.replaceAll('-', '\\-')),
				'the API key must never reach the server logs',
			);
			for (const address of [OWNER.email, STAFF_EMAIL]) {
				assert.doesNotMatch(
					logs,
					new RegExp(address.replaceAll('.', '\\.')),
					'recipient addresses must never reach the server logs',
				);
			}

			// Force one retry through a stub failure, then prove the retry reuses
			// the SAME stable idempotency key (no double-send risk).
			stub.failNextByKey.set(ownerRow.id, 500);
			withDb(dataDir, (db) => {
				db.prepare(
					"UPDATE mail_outbox SET status = 'queued', attempts = 0, next_attempt_at = NULL, sent_at = NULL WHERE id = ?",
				).run(ownerRow.id);
			});
			await pollUntil('failed attempt recorded', async () => {
				const row = mailRows(dataDir).find((r) => r.id === ownerRow.id);
				return (
						row.attempts === 1
							&& row.status === 'queued'
							&& row.last_error?.includes('HTTP 500')
					) ?
						row
					:	null;
			});
			const failedRow = mailRows(dataDir).find(
				(r) => r.id === ownerRow.id,
			);
			assert.equal(
				failedRow.last_error,
				'Live mail provider responded with HTTP 500',
				'failure reason is sanitized to the status code',
			);
			assert.equal(emlFiles(dataDir).length, 0);

			withDb(dataDir, (db) => {
				db.prepare(
					'UPDATE mail_outbox SET next_attempt_at = 0 WHERE id = ?',
				).run(ownerRow.id);
			});
			await pollUntil('retry delivered', async () => {
				const row = mailRows(dataDir).find((r) => r.id === ownerRow.id);
				return row.status === 'sent' && row.attempts === 2 ? row : null;
			});
			const ownerAttempts = stub.requests.filter(
				(record) => record.idempotencyKey === ownerRow.id,
			);
			assert.equal(
				ownerAttempts.length,
				3,
				'initial delivery, failed attempt and retry share one stable idempotency key',
			);
			assert.deepEqual(
				ownerAttempts[0].body,
				ownerAttempts[2].body,
				'retry payload is byte-identical to the first send',
			);
		} finally {
			if (server) {
				await server.close();
			}
			await stub.close();
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	},
);
