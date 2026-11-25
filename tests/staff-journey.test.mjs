// Staff queue journey test: the /staff page and its backing API.
//
// Verifies:
// - /staff SSR is a neutral shell: it always renders the staff sign-in entry
//   (/sign-in?next=/staff) and NEVER server-renders report content or owner
//   contact details, regardless of the session cookie (the queue is fetched
//   client-side after a verified staff session).
// - The staff queue API shows ready/pending/failed plus consultation state
//   with owner contact details, newest first, staff-only.
//
// Run against a real built Nitro server on an isolated localhost port:
//   npm run build
//   node --test tests/staff-journey.test.mjs
//
// Demo credentials below are fictional fixtures, not secrets.

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

const STAFF_EMAIL = 'staff-queue@example.test';
const STAFF_PASSWORD = 'test-staff-password-1234';

const OWNER_A = {
	email: 'owner-a-queue@example.test',
	password: 'owner-a-pass-1234',
	profile: {
		name: '田中 花子',
		businessName: '湯の花旅館',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};

const OWNER_B = {
	email: 'owner-b-queue@example.test',
	password: 'owner-b-pass-1234',
	profile: {
		name: 'John Birch',
		businessName: 'Birch Snow Tours',
		businessType: 'tourism',
		municipality: 'Kutchan Town',
		locale: 'en',
	},
};

const TRANSCRIPT_A =
	'面接者: 現状を教えてください。\n経営者: 人手不足で繁忙期は家族総出です。\n面接者: ありがとうございました。';
const TRANSCRIPT_B =
	'Interviewer: Tell us about your business.\nOwner: Winter tours are fully booked, summer is empty.\nInterviewer: Thank you.';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Cross-owner data that must NEVER appear in the SSR HTML of /staff. A
// session holder's OWN profile legitimately appears in the Nuxt SSR payload
// (the shell serializes GET /api/auth/session), so own markers are checked
// per-case below instead of globally.
const FOREIGN_OWNER_MARKERS = [
	OWNER_B.email,
	OWNER_B.profile.name,
	OWNER_B.profile.businessName,
	STAFF_PASSWORD,
];

function expectSsrNeutral(label, ssr, reportIds, { allowOwnerA = false } = {}) {
	// Owner A's own profile legitimately appears in their own SSR session
	// payload; only foreign-owner data is forbidden unconditionally.
	const markers = [
		...FOREIGN_OWNER_MARKERS,
		...(allowOwnerA ?
			[]
		:	[OWNER_A.email, OWNER_A.profile.name, OWNER_A.profile.businessName]),
	];
	for (const marker of markers) {
		assert.ok(
			!ssr.text.includes(marker),
			`SSR HTML must not contain "${marker}" (${label})`,
		);
	}
	for (const reportId of reportIds) {
		assert.ok(
			!ssr.text.includes(reportId),
			`SSR HTML must not contain report id ${reportId} (${label})`,
		);
	}
}

const dataDir = path.join(
	repoRoot,
	'.data',
	'test',
	`staff-journey-${process.pid}`,
);

fs.rmSync(dataDir, { recursive: true, force: true });

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

function expectErrorCode(step, response, code) {
	assert.equal(
		response.json?.data?.error,
		code,
		`${step}: expected data.error "${code}", got ${response.text.slice(0, 300)}`,
	);
}

async function pollUntil(label, fn, timeoutMs = 20000, intervalMs = 250) {
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

function withDb(fn) {
	const db = new DatabaseSync(path.join(dataDir, 'app.db'));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

test(
	'staff journey: neutral SSR shell, staff-only queue API, ready/pending/consultation states',
	{ timeout: 300000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);

		const running = [];
		async function startServer(label, pollMs) {
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
					WORKER_POLL_MS: pollMs,
				},
				stdio: ['ignore', 'inherit', 'inherit'],
			});
			const entry = {
				close: async () => {
					child.kill();
					await pollUntil(`${label} exit`, async () => {
						return (
							child.exitCode !== null || child.signalCode !== null
						);
					});
					const index = running.indexOf(entry);
					if (index >= 0) {
						running.splice(index, 1);
					}
				},
			};
			running.push(entry);
			await pollUntil(`${label} ready`, async () => {
				const probe = await request(baseUrl, 'GET', '/', {
					origin: null,
				});
				return probe.status === 200;
			});
			return { port, baseUrl };
		}

		try {
			// ------------------------------------------------------------------
			// Phase 1 — worker paused (60s poll): freshly submitted reports stay
			// deterministically `pending` for the queue assertions.
			// ------------------------------------------------------------------
			const a = await startServer('server A', '60000');
			const jarA = newCookieJar();
			const jarB = newCookieJar();
			const jarStaff = newCookieJar();

			console.log('## step: /staff SSR is the neutral sign-in shell');
			const ssrSignedOut = await request(a.baseUrl, 'GET', '/staff', {
				origin: null,
			});
			expectStatus('staff page signed-out', ssrSignedOut, 200);
			assert.ok(
				ssrSignedOut.text.includes('page-shell'),
				'the staff page uses the shared page shell primitive',
			);
			assert.ok(
				ssrSignedOut.text.includes('/sign-in?next=%2Fstaff'),
				'the staff page offers sign-in with the next=/staff return',
			);
			assert.ok(
				ssrSignedOut.text.includes('スタッフメニュー'),
				'the default ja locale strings render on the server',
			);

			console.log('## step: staff queue API auth walls');
			expectErrorCode(
				'staff queue signed-out',
				await request(a.baseUrl, 'GET', '/api/staff/reports', {
					origin: null,
				}),
				'unauthorized',
			);

			console.log('## step: two owners submit demo interviews');
			const reportIds = new Map();
			for (const [owner, jar] of [
				[OWNER_A, jarA],
				[OWNER_B, jarB],
			]) {
				expectStatus(
					`signup ${owner.email}`,
					await request(a.baseUrl, 'POST', '/api/auth/signup', {
						jar,
						body: owner,
					}),
					201,
				);
				const start = await request(
					a.baseUrl,
					'POST',
					'/api/interviews/start',
					{ jar, body: { consent: true, mode: 'demo' } },
				);
				expectStatus(`start ${owner.email}`, start, 201);
				const complete = await request(
					a.baseUrl,
					'POST',
					`/api/interviews/${start.json.interview.id}/complete`,
					{
						jar,
						body: {
							transcript:
								owner === OWNER_A ? TRANSCRIPT_A : TRANSCRIPT_B,
						},
					},
				);
				expectStatus(`complete ${owner.email}`, complete, 200);
				reportIds.set(owner.email, complete.json.reportId);
			}
			const reportAId = reportIds.get(OWNER_A.email);
			const reportBId = reportIds.get(OWNER_B.email);

			console.log('## step: staff login and pending queue');
			expectStatus(
				'staff login',
				await request(a.baseUrl, 'POST', '/api/auth/login', {
					jar: jarStaff,
					body: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
				}),
				200,
			);
			const queuePending = await request(
				a.baseUrl,
				'GET',
				'/api/staff/reports',
				{ jar: jarStaff, origin: null },
			);
			expectStatus('queue while pending', queuePending, 200);
			assert.match(queuePending.headers.get('cache-control'), /no-store/);
			assert.equal(queuePending.json.reports.length, 2);
			const [pendingB, pendingA] = queuePending.json.reports;
			assert.equal(pendingB.id, reportBId, 'newest first');
			assert.equal(pendingA.id, reportAId);
			for (const [summary, owner] of [
				[pendingA, OWNER_A],
				[pendingB, OWNER_B],
			]) {
				assert.equal(summary.status, 'pending');
				assert.equal(summary.consultationRequestedAt, null);
				assert.equal(summary.ownerEmail, owner.email);
				assert.equal(summary.ownerName, owner.profile.name);
				assert.equal(summary.businessName, owner.profile.businessName);
				assert.equal(summary.locale, owner.profile.locale);
				assert.match(summary.createdAt, ISO_RE);
				assert.match(summary.ownerId, /^[0-9a-f-]{36}$/);
			}

			console.log('## step: owner session cannot read the staff queue');
			expectErrorCode(
				'owner on staff queue',
				await request(a.baseUrl, 'GET', '/api/staff/reports', {
					jar: jarA,
				}),
				'forbidden',
			);

			await running[running.length - 1].close();

			// ------------------------------------------------------------------
			// Phase 2 — worker running: pending reports become ready; the queue
			// must follow the state changes and the consultation timestamp.
			// ------------------------------------------------------------------
			const b = await startServer('server B', '500');
			await pollUntil('report A ready', async () => {
				const response = await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportAId}`,
					{ jar: jarA, origin: null },
				);
				expectStatus('report A detail', response, 200);
				return response.json.report.status === 'ready';
			});

			console.log('## step: queue reflects ready + consultation state');
			const readyQueue = await request(
				b.baseUrl,
				'GET',
				'/api/staff/reports',
				{ jar: jarStaff, origin: null },
			);
			expectStatus('queue while ready', readyQueue, 200);
			assert.deepEqual(
				readyQueue.json.reports.map((report) => report.status),
				['ready', 'ready'],
			);
			assert.deepEqual(
				readyQueue.json.reports.map((report) => report.id),
				[reportBId, reportAId],
			);
			expectStatus(
				'consultation A',
				await request(
					b.baseUrl,
					'POST',
					`/api/reports/${reportAId}/consultation`,
					{ jar: jarA },
				),
				200,
			);
			const consultQueue = await request(
				b.baseUrl,
				'GET',
				'/api/staff/reports',
				{ jar: jarStaff, origin: null },
			);
			const consultA = consultQueue.json.reports.find(
				(report) => report.id === reportAId,
			);
			const consultB = consultQueue.json.reports.find(
				(report) => report.id === reportBId,
			);
			assert.match(consultA.consultationRequestedAt, ISO_RE);
			assert.equal(consultB.consultationRequestedAt, null);

			console.log('## step: queue reflects a failed report (synthetic)');
			const savedB = withDb((db) =>
				db
					.prepare('SELECT status, content FROM reports WHERE id = ?')
					.get(reportBId),
			);
			withDb((db) => {
				db.prepare(
					"UPDATE reports SET status = 'failed', content = NULL, failure_reason = 'synthetic QA failure' WHERE id = ?",
				).run(reportBId);
			});
			const failedQueue = await request(
				b.baseUrl,
				'GET',
				'/api/staff/reports',
				{ jar: jarStaff, origin: null },
			);
			const failedB = failedQueue.json.reports.find(
				(report) => report.id === reportBId,
			);
			assert.equal(failedB.status, 'failed');
			withDb((db) => {
				db.prepare(
					"UPDATE reports SET status = 'ready', content = ?, failure_reason = NULL WHERE id = ?",
				).run(savedB.content, reportBId);
			});

			console.log(
				'## step: /staff SSR never carries report data or contact details',
			);
			for (const [label, jar, options] of [
				['staff session', jarStaff, {}],
				['owner session', jarA, { allowOwnerA: true }],
				['no session', null, {}],
			]) {
				const ssr = await request(b.baseUrl, 'GET', '/staff', {
					jar: jar ?? undefined,
					origin: null,
				});
				expectStatus(`staff page SSR (${label})`, ssr, 200);
				expectSsrNeutral(label, ssr, [reportAId, reportBId], options);
			}

			console.log('## step: cleanup');
			await running[running.length - 1].close();
			fs.rmSync(dataDir, { recursive: true, force: true });
		} finally {
			for (const entry of running.splice(0)) {
				await entry.close();
			}
		}
	},
);
