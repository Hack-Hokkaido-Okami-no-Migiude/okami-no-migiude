// End-to-end API journey test for the Okami no Migiude MVP thin slice.
//
// Run against a real built Nitro server on an isolated localhost port:
//   npm run build
//   node --test tests/api-journey.test.mjs
//
// No HTTP test backdoors: interview/session expiry is proven by editing the
// synthetic SQLite data directly (node:sqlite) between/restart-free requests.
// Demo credentials below are fictional fixtures, not secrets.

import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');
// Server entry can be pointed at an isolated build output (e.g. a review
// slice building into its own directory instead of the shared .output).
const serverEntry =
	process.env.OKAMI_TEST_SERVER_ENTRY
	|| path.join(repoRoot, '.output', 'server', 'index.mjs');

const STAFF_EMAIL = 'staff@example.test';
const STAFF_PASSWORD = 'test-staff-password-1234';

const OWNER_A = {
	email: 'Owner-A@EXAMPLE.test',
	password: 'owner-a-pass-1234',
	profile: {
		name: '田中 花子',
		businessName: '湯の花旅館',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		phone: '0136-00-0000',
		website: 'https://example.test/yunohana',
		note: '冬のインバウンド対応について相談したい',
		locale: 'ja',
	},
	unexpectedExtra: 'ignored',
};

const OWNER_B = {
	email: 'owner-b@example.test',
	password: 'owner-b-pass-1234',
	profile: {
		name: 'John Birch',
		businessName: 'Birch Snow Tours',
		businessType: 'other',
		otherBusinessType: 'Backcountry snowshoe guides',
		municipality: 'Kutchan Town',
		locale: 'en',
	},
};

const OWNER_C = {
	email: 'owner-c@example.test',
	password: 'owner-c-pass-1234',
	profile: {
		name: '山田 太郎',
		businessName: 'キッチン遊び場',
		municipality: '岩見沢市',
	},
};

const OWNER_D = {
	email: 'owner-d@example.test',
	password: 'owner-d-pass-1234',
	profile: {
		name: '佐藤 一郎',
		businessName: '大通商店堂',
		businessType: 'retail',
		municipality: '札幌市',
		locale: 'ja',
	},
};

const OWNER_E = {
	email: 'owner-e@example.test',
	password: 'owner-e-pass-1234',
	profile: {
		name: 'Emily Stone',
		businessName: 'Harbor Tours',
		businessType: 'tourism',
		municipality: '函館市',
		locale: 'en',
	},
};

const OWNER_F = {
	email: 'owner-f@example.test',
	password: 'owner-f-pass-1234',
	profile: {
		name: '鈴木 二郎',
		businessName: 'ロジ支援社',
		businessType: 'transport',
		municipality: '旭川市',
		locale: 'ja',
	},
};

const EXTRA_STAFF_EMAIL = 'extra-staff@example.test';

// Canonical public origin for the origin-policy test server. The server
// itself listens on plain http loopback; PUBLIC_BASE_URL claims https.
const CANONICAL_ORIGIN = 'https://demo.example.test';

// Fictional demo interview transcripts (labeled scripted substitute, §11).
const TRANSCRIPT_A = [
	'面接者: こんにちは。本日はよろしくお願いします。まず、旅館の現在の状況を教えてください。',
	'経営者: はい。湯の花旅館はニセコ町で30年続く小さな旅館で、客室は12室あります。',
	'面接者: 直近の経営で特に課題に感じていることは何ですか。',
	'経営者: 何よりも人手不足です。清掃と朝食担当のパートさんが採用できず、繁忙期は家族総出で回しています。',
	'面接者: 繁忙期と閑散期の差はどのくらいですか。',
	'経営者: 12月から2月はスキー客でほぼ満室ですが、6月の平日は客室稼働率が2割まで落ちます。季節による差が大きいです。',
	'面接者: お客さまはどのような経路で来られますか。',
	'経営者: リピーターと口コミが7割で、SNSからの予約はほとんどありません。予約は電話が中心で、Web予約はまだ作っていません。',
	'面接者: 料金の見直しについてはいかがですか。',
	'経営者: 値上げには不安があります。近隣と比べて単価が低いのに、なかなか踏み切れません。',
	'面接者: 今後の目標を教えてください。',
	'経営者: 来年は外国人観光客を増やして通年で埋めることと、後継ぎに頼れる体制を作ることです。',
	'面接者: 本日はありがとうございました。',
].join('\n');

const TRANSCRIPT_B = [
	'Interviewer: Please tell us about your business.',
	'Owner: We run guided snowshoe tours around Kutchan. Winter is fully booked but the green season has almost no customers.',
	'Interviewer: What is your biggest challenge?',
	'Owner: Marketing is weak. We depend on repeat guests and word of mouth, and our website cannot take online reservations yet.',
	'Interviewer: Any goals for next year?',
	'Owner: We want to add summer plans and raise our rates a little to cover insurance costs.',
].join('\n');

const TRANSCRIPT_C = [
	'面接者: 事業の現状を教えてください。',
	'経営者: 昼は近隣の会社員で埋まりますが、夜は客が減り、スタッフも人手不足です。仕入れの原価が上がって利益が減っています。',
	'面接者: 今後の計画は？',
	'経営者: テイクアウトを増やして売上を安定させたいです。',
].join('\n');

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const dataDir = path.join(
	repoRoot,
	'.data',
	'test',
	`api-journey-${process.pid}`,
);

function cleanupDataDir() {
	removeDir(dataDir);
}

cleanupDataDir();

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
				const name = pair.slice(0, eq).trim();
				const value = pair.slice(eq + 1).trim();
				if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) {
					jar.map.delete(name);
				} else {
					jar.map.set(name, value);
				}
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
	return {
		status: response.status,
		headers: response.headers,
		setCookies: response.headers.getSetCookie(),
		text,
		json,
	};
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
	assert.equal(
		typeof response.json?.data?.message,
		'string',
		`${step}: data.message should be a human-readable string`,
	);
	assert.doesNotMatch(
		response.text,
		/客室は12室あります|green season has almost no customers/,
		`${step}: error response must never leak transcript excerpts`,
	);
}

async function pollUntil(label, fn, timeoutMs = 20000, intervalMs = 300) {
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

function withDb(fn, dir = dataDir) {
	const db = new DatabaseSync(path.join(dir, 'app.db'));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function sha256HexOf(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Removes a temp dir, retrying briefly — Windows releases file handles for
 * killed child processes with a short delay. */
function removeDir(dir) {
	let lastError = null;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			lastError = error;
			sleepSync(150);
		}
	}
	throw lastError;
}

/** POSTs a chunked (no content-length) body of totalBytes 'a' characters. */
function requestChunkedBytes(baseUrl, pathName, totalBytes, chunkSize) {
	return new Promise((resolve, reject) => {
		const url = new URL(pathName, baseUrl);
		const req = http.request(
			url,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'transfer-encoding': 'chunked',
				},
			},
			(res) => {
				const chunks = [];
				res.on('data', (chunk) => chunks.push(chunk));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					let json = null;
					try {
						json = text.length > 0 ? JSON.parse(text) : null;
					} catch {
						// Non-JSON body stays null.
					}
					resolve({ status: res.statusCode, text, json });
				});
			},
		);
		req.on('error', reject);
		const chunk = Buffer.alloc(chunkSize, 0x61);
		for (let sent = 0; sent < totalBytes; sent += chunkSize) {
			req.write(
				totalBytes - sent >= chunkSize ?
					chunk
				:	chunk.subarray(0, totalBytes - sent),
			);
		}
		req.end();
	});
}

/** Local TCP addresses this pid is listening on: `lsof` on macOS/Linux,
 * `netstat -ano -p tcp` on Windows. */
function listeningAddresses(pid) {
	const pidText = String(pid);
	if (process.platform === 'win32') {
		const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
			encoding: 'utf8',
		});
		const addresses = [];
		for (const line of out.split(/\r?\n/)) {
			const parts = line.trim().split(/\s+/);
			if (
				parts.length < 5
				|| parts[0] !== 'TCP'
				|| parts[parts.length - 1] !== pidText
			) {
				continue;
			}
			// Listener rows: LISTENING state and/or foreign address 0.0.0.0:0.
			const isListener =
				parts[3] === 'LISTENING' || parts[2] === '0.0.0.0:0';
			if (isListener) {
				addresses.push(parts[1]);
			}
		}
		return addresses;
	}
	const out = execFileSync(
		'lsof',
		['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pidText],
		{ encoding: 'utf8' },
	);
	const addresses = [];
	for (const line of out.split(/\r?\n/)) {
		const parts = line.trim().split(/\s+/);
		if (
			parts.length > 8
			&& parts[1] === pidText
			&& parts[parts.length - 1] === '(LISTEN)'
		) {
			addresses.push(parts[parts.length - 2]);
		}
	}
	return addresses;
}

/** Spawns a built server on a free loopback port with pinned test env. */
async function startJourneyServer({
	label = 'server',
	dataDir: dir,
	pollMs = '1000',
	publicBaseUrl: publicBaseOverride,
	staffEmails = '',
	staffPassword = '',
	extraEnv = {},
}) {
	const port = await freePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const env = {
		...process.env,
		PORT: String(port),
		HOST: '127.0.0.1',
		DATA_DIR: dir,
		PUBLIC_BASE_URL: publicBaseOverride ?? baseUrl,
		STAFF_EMAILS: staffEmails,
		STAFF_PASSWORD: staffPassword,
		INTEGRATION_BASE_URL: '',
		INTEGRATION_TOKEN: '',
		CLOCK_OFFSET_MS: '',
		WORKER_POLL_MS: pollMs,
		...extraEnv,
	};
	const child = spawn(process.execPath, [serverEntry], {
		cwd: repoRoot,
		env,
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	await pollUntil(`${label} ready`, async () => {
		const probe = await request(baseUrl, 'GET', '/', { origin: null });
		return probe.status === 200;
	});
	return {
		port,
		baseUrl,
		close: async () => {
			child.kill();
			await pollUntil(
				`${label} process exit`,
				async () =>
					child.exitCode !== null || child.signalCode !== null,
				10000,
				100,
			);
		},
	};
}

test(
	'api journey: signup, consent, demo report, outbox, staff, expiry',
	{
		timeout: 300000,
	},
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
					await pollUntil(
						`${label} process exit`,
						async () =>
							child.exitCode !== null
							|| child.signalCode !== null,
						10000,
						100,
					);
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
			// --------------------------------------------------------------------
			// Phase 1 — server A with the background worker paused (60s poll), so
			// the freshly submitted report is deterministically still `pending`.
			// --------------------------------------------------------------------
			const a = await startServer('server A', '60000');
			const jarA = newCookieJar();
			const jarB = newCookieJar();
			const jarC = newCookieJar();
			const jarStaff = newCookieJar();

			console.log('## step: signed-out protection');
			expectStatus(
				'current signed-out',
				await request(a.baseUrl, 'GET', '/api/interviews/current', {
					origin: null,
				}),
				401,
			);
			expectErrorCode(
				'current signed-out',
				await request(a.baseUrl, 'GET', '/api/interviews/current', {
					origin: null,
				}),
				'unauthorized',
			);
			expectErrorCode(
				'consultation signed-out',
				await request(
					a.baseUrl,
					'POST',
					`/api/reports/${crypto.randomUUID()}/consultation`,
					{ origin: null },
				),
				'unauthorized',
			);
			expectErrorCode(
				'staff reports signed-out',
				await request(a.baseUrl, 'GET', '/api/staff/reports', {
					origin: null,
				}),
				'unauthorized',
			);

			console.log('## step: same-origin enforcement on writes');
			const evilOrigin = await request(
				a.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_A,
					origin: 'https://evil.example',
				},
			);
			expectStatus('signup cross-origin', evilOrigin, 403);
			expectErrorCode('signup cross-origin', evilOrigin, 'forbidden');

			console.log(
				'## step: unauthenticated JSON bodies are bounded (413), not buffered',
			);
			const oversizedSignup = await request(
				a.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: {
						...OWNER_A,
						email: 'oversize@example.test',
						note: 'あ'.repeat(1_100_000), // ≈3.3 MB JSON-encoded
					},
				},
			);
			expectStatus('oversized signup body', oversizedSignup, 413);
			expectErrorCode(
				'oversized signup body',
				oversizedSignup,
				'payload_too_large',
			);
			const oversizedChunked = await requestChunkedBytes(
				a.baseUrl,
				'/api/auth/signup',
				3 * 1024 * 1024,
				512 * 1024,
			);
			expectStatus('oversized chunked body', oversizedChunked, 413);
			expectErrorCode(
				'oversized chunked body',
				oversizedChunked,
				'payload_too_large',
			);

			console.log(
				'## step: owner A signup (ja, accommodation, exact payload)',
			);
			const signupA = await request(
				a.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_A,
					jar: jarA,
				},
			);
			expectStatus('signup A', signupA, 201);
			const userA = signupA.json.user;
			assert.equal(userA.role, 'owner');
			assert.match(userA.id, /^[0-9a-f-]{36}$/);
			assert.equal(userA.profile.email, 'owner-a@example.test');
			assert.equal(userA.profile.name, '田中 花子');
			assert.equal(userA.profile.businessName, '湯の花旅館');
			assert.equal(userA.profile.businessType, 'accommodation');
			assert.equal(userA.profile.otherBusinessType, null);
			assert.equal(userA.profile.municipality, 'ニセコ町');
			assert.equal(userA.profile.phone, '0136-00-0000');
			assert.equal(
				userA.profile.website,
				'https://example.test/yunohana',
			);
			assert.equal(
				userA.profile.note,
				'冬のインバウンド対応について相談したい',
			);
			assert.equal(userA.profile.locale, 'ja');
			assert.equal(signupA.setCookies.length, 1);
			const cookieA = signupA.setCookies[0];
			assert.match(cookieA, /^session=/);
			assert.match(cookieA, /HttpOnly/i);
			assert.match(cookieA, /SameSite=Lax/i);
			assert.match(cookieA, /Path=\//i);
			assert.doesNotMatch(cookieA, /Secure/i);

			console.log('## step: signup validation and conflicts');
			expectErrorCode(
				'signup duplicate email',
				await request(a.baseUrl, 'POST', '/api/auth/signup', {
					body: OWNER_A,
				}),
				'email_taken',
			);
			expectErrorCode(
				'signup staff-reserved email',
				await request(a.baseUrl, 'POST', '/api/auth/signup', {
					body: {
						email: STAFF_EMAIL,
						password: 'staff-attempt-1',
						profile: { ...OWNER_A.profile, name: 'Staff Attempt' },
					},
				}),
				'email_taken',
			);
			for (const [label, broken] of Object.entries({
				'short password': {
					...OWNER_A,
					password: 'short',
					email: 'v1@example.test',
				},
				'bad email': {
					...OWNER_A,
					email: 'not-an-email',
					password: 'long-enough-1',
				},
				'bad businessType': {
					...OWNER_A,
					email: 'v2@example.test',
					password: 'long-enough-1',
					profile: { ...OWNER_A.profile, businessType: 'spa' },
				},
				'blank owner name': {
					...OWNER_A,
					email: 'v3@example.test',
					profile: { ...OWNER_A.profile, name: '  ' },
				},
				'blank business name': {
					...OWNER_A,
					email: 'v5@example.test',
					profile: { ...OWNER_A.profile, businessName: '  ' },
				},
				'blank municipality': {
					...OWNER_A,
					email: 'v6@example.test',
					profile: { ...OWNER_A.profile, municipality: '  ' },
				},
				'bad locale': {
					...OWNER_A,
					email: 'v4@example.test',
					password: 'long-enough-1',
					profile: { ...OWNER_A.profile, locale: 'fr' },
				},
			})) {
				const response = await request(
					a.baseUrl,
					'POST',
					'/api/auth/signup',
					{
						body: broken,
					},
				);
				expectStatus(`signup ${label}`, response, 400);
				expectErrorCode(`signup ${label}`, response, 'validation');
			}

			console.log('## step: session endpoints');
			const sessionA = await request(
				a.baseUrl,
				'GET',
				'/api/auth/session',
				{
					jar: jarA,
					origin: null,
				},
			);
			expectStatus('session with cookie', sessionA, 200);
			assert.equal(sessionA.json.user.id, userA.id);
			const sessionNone = await request(
				a.baseUrl,
				'GET',
				'/api/auth/session',
				{
					origin: null,
				},
			);
			expectStatus('session without cookie', sessionNone, 200);
			assert.equal(sessionNone.json.user, null);

			console.log('## step: role walls');
			expectErrorCode(
				'owner cannot list staff reports',
				await request(a.baseUrl, 'GET', '/api/staff/reports', {
					jar: jarA,
				}),
				'forbidden',
			);

			console.log(
				'## step: interview start validation, gating, idempotency walls',
			);
			expectErrorCode(
				'start consent missing',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { mode: 'demo' },
				}),
				'validation',
			);
			expectErrorCode(
				'start consent not boolean true',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: 'true', mode: 'demo' },
				}),
				'validation',
			);
			expectErrorCode(
				'start live unavailable',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: true, mode: 'live' },
				}),
				'mode_unavailable',
			);
			// The agent is unconfigured on this deployment: live start is
			// refused before anything is created (honest unavailable state).
			expectStatus(
				'start live unavailable status',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: true, mode: 'live' },
				}),
				409,
			);
			// The session endpoint mints conversations only for an active
			// live interview, and this deployment has no voice agent
			// configured at all: the honest unavailable envelope answers
			// before anything else, and a signed-out caller never gets that
			// far.
			const voiceSignedOut = await request(
				a.baseUrl,
				'POST',
				'/api/voice/sessions',
				{},
			);
			expectStatus('voice session signed-out', voiceSignedOut, 401);
			expectErrorCode(
				'voice session signed-out',
				voiceSignedOut,
				'unauthorized',
			);
			const voiceRefused = await request(
				a.baseUrl,
				'POST',
				'/api/voice/sessions',
				{
					jar: jarA,
					body: { consent: true },
				},
			);
			expectStatus('voice session unavailable', voiceRefused, 503);
			expectErrorCode(
				'voice session unavailable',
				voiceRefused,
				'voice_unavailable',
			);
			expectErrorCode(
				'start unknown mode',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: true, mode: 'video' },
				}),
				'validation',
			);
			const startA = await request(
				a.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					jar: jarA,
					body: { consent: true, mode: 'demo' },
				},
			);
			expectStatus('start A', startA, 201);
			const interviewA = startA.json.interview;
			assert.equal(interviewA.status, 'active');
			assert.equal(interviewA.mode, 'demo');
			assert.match(interviewA.id, /^[0-9a-f-]{36}$/);
			assert.match(interviewA.deadlineAt, ISO_RE);
			const spanMs =
				Date.parse(interviewA.deadlineAt)
				- Date.parse(new Date().toISOString());
			assert.ok(
				spanMs > 59 * 60 * 1000 && spanMs < 61 * 60 * 1000,
				`deadline should be about one hour ahead, got ${spanMs}ms`,
			);
			expectErrorCode(
				'start while active',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: true, mode: 'demo' },
				}),
				'interview_active',
			);
			const currentA1 = await request(
				a.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar: jarA, origin: null },
			);
			expectStatus('current active', currentA1, 200);
			assert.equal(currentA1.json.interview.id, interviewA.id);
			assert.equal(currentA1.json.reportId, null);

			console.log(
				'## step: interview complete validation and submission',
			);
			expectErrorCode(
				'complete unknown interview',
				await request(
					a.baseUrl,
					'POST',
					`/api/interviews/${crypto.randomUUID()}/complete`,
					{ jar: jarA, body: { transcript: 'x' } },
				),
				'not_found',
			);
			for (const [label, transcript] of Object.entries({
				empty: '',
				whitespace: '   \n	  ',
				'too long': 'あ'.repeat(200001),
			})) {
				const response = await request(
					a.baseUrl,
					'POST',
					`/api/interviews/${interviewA.id}/complete`,
					{ jar: jarA, body: { transcript } },
				);
				expectStatus(`complete ${label}`, response, 400);
				expectErrorCode(`complete ${label}`, response, 'validation');
			}
			const completeA = await request(
				a.baseUrl,
				'POST',
				`/api/interviews/${interviewA.id}/complete`,
				{ jar: jarA, body: { transcript: TRANSCRIPT_A } },
			);
			expectStatus('complete A', completeA, 200);
			assert.equal(completeA.json.interview.id, interviewA.id);
			assert.equal(completeA.json.interview.status, 'submitted');
			const reportAId = completeA.json.reportId;
			assert.match(reportAId, /^[0-9a-f-]{36}$/);
			expectStatus(
				'complete A repeat (idempotent)',
				await request(
					a.baseUrl,
					'POST',
					`/api/interviews/${interviewA.id}/complete`,
					{ jar: jarA, body: { transcript: TRANSCRIPT_A } },
				),
				200,
			);
			const repeatDifferent = await request(
				a.baseUrl,
				'POST',
				`/api/interviews/${interviewA.id}/complete`,
				{ jar: jarA, body: { transcript: '別の内容の再送です' } },
			);
			expectStatus(
				'complete A repeat with new body',
				repeatDifferent,
				200,
			);
			assert.equal(repeatDifferent.json.reportId, reportAId);

			console.log(
				'## step: submitted state is the single interview per owner',
			);
			const currentA2 = await request(
				a.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar: jarA, origin: null },
			);
			expectStatus('current submitted', currentA2, 200);
			assert.equal(currentA2.json.interview.id, interviewA.id);
			assert.equal(currentA2.json.interview.status, 'submitted');
			assert.equal(currentA2.json.reportId, reportAId);
			expectErrorCode(
				'start after submission',
				await request(a.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarA,
					body: { consent: true, mode: 'demo' },
				}),
				'already_submitted',
			);

			console.log('## step: pending report is private and not ready yet');
			const reportA1 = await request(
				a.baseUrl,
				'GET',
				`/api/reports/${reportAId}`,
				{ jar: jarA, origin: null },
			);
			expectStatus('report A pending', reportA1, 200);
			assert.equal(reportA1.json.report.id, reportAId);
			assert.equal(reportA1.json.report.status, 'pending');
			assert.equal(reportA1.json.report.content, null);
			assert.equal(reportA1.json.report.failureReason, null);
			assert.equal(reportA1.json.report.consultationRequestedAt, null);
			assert.equal(reportA1.json.report.businessName, '湯の花旅館');
			assert.equal(reportA1.json.report.locale, 'ja');
			assert.equal(reportA1.json.report.ownerId, userA.id);
			assert.equal(reportA1.json.report.interviewId, interviewA.id);
			assert.match(reportA1.headers.get('cache-control'), /no-store/);
			expectErrorCode(
				'download pending',
				await request(
					a.baseUrl,
					'GET',
					`/api/reports/${reportAId}/download`,
					{ jar: jarA, origin: null },
				),
				'not_ready',
			);
			expectErrorCode(
				'consultation pending',
				await request(
					a.baseUrl,
					'POST',
					`/api/reports/${reportAId}/consultation`,
					{ jar: jarA },
				),
				'not_ready',
			);

			console.log(
				'## step: kill server A while the report is still pending',
			);
			await running[running.length - 1].close();

			// --------------------------------------------------------------------
			// Phase 2 — server B on the same SQLite data dir with the worker
			// running: durable pending state must recover and complete.
			// --------------------------------------------------------------------
			const b = await startServer('server B', '1000');

			console.log(
				'## step: durable session survives restart; login flows',
			);
			const sessionAgain = await request(
				b.baseUrl,
				'GET',
				'/api/auth/session',
				{
					jar: jarA,
					origin: null,
				},
			);
			expectStatus('session survives restart', sessionAgain, 200);
			assert.equal(sessionAgain.json.user.id, userA.id);
			const badPassword = await request(
				b.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					body: {
						email: OWNER_A.email,
						password: 'wrong-password-1',
					},
				},
			);
			expectStatus('login wrong password', badPassword, 401);
			expectErrorCode(
				'login wrong password',
				badPassword,
				'invalid_credentials',
			);
			const badEmail = await request(
				b.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					body: {
						email: 'nobody@example.test',
						password: 'wrong-password-1',
					},
				},
			);
			expectStatus('login wrong email', badEmail, 401);
			expectErrorCode(
				'login wrong email',
				badEmail,
				'invalid_credentials',
			);
			assert.equal(
				badPassword.text,
				badEmail.text,
				'login errors are identical',
			);
			const loginA = await request(b.baseUrl, 'POST', '/api/auth/login', {
				origin: null,
				jar: jarA,
				body: { email: OWNER_A.email, password: OWNER_A.password },
			});
			expectStatus('login A without origin header', loginA, 200);
			assert.equal(loginA.json.user.id, userA.id);

			console.log('## step: recovered pending report becomes ready');
			const reportA2 = await pollUntil('report A ready', async () => {
				const response = await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportAId}`,
					{ jar: jarA, origin: null },
				);
				expectStatus('report A detail', response, 200);
				return response.json.report.status === 'ready' ?
						response
					:	null;
			});
			const reportA = reportA2.json.report;
			assert.equal(reportA.status, 'ready');
			assert.equal(reportA.businessName, '湯の花旅館');
			assert.equal(reportA.locale, 'ja');
			assert.match(reportA.readyAt, ISO_RE);
			assert.match(reportA.createdAt, ISO_RE);
			assert.equal(reportA.consultationRequestedAt, null);
			const contentA = reportA.content;
			assert.equal(typeof contentA, 'string');
			assert.match(contentA, /^# /m, 'markdown heading');
			assert.match(contentA, /湯の花旅館/);
			assert.match(contentA, /自動下書き（ルールベース）/);
			assert.match(contentA, /人材/);
			assert.match(contentA, /繁忙/);
			assert.doesNotMatch(
				contentA,
				/客室は12室あります/,
				'report must not dump verbatim transcript excerpts',
			);
			assert.match(reportA2.headers.get('cache-control'), /no-store/);

			console.log('## step: private markdown attachment download');
			const downloadA = await request(
				b.baseUrl,
				'GET',
				`/api/reports/${reportAId}/download`,
				{ jar: jarA, origin: null },
			);
			expectStatus('download A', downloadA, 200);
			assert.equal(
				downloadA.headers.get('content-type'),
				'text/markdown; charset=utf-8',
			);
			assert.equal(
				downloadA.headers.get('content-disposition'),
				`attachment; filename="report-${reportAId}.md"`,
			);
			assert.match(downloadA.headers.get('cache-control'), /no-store/);
			assert.equal(downloadA.text, contentA);

			console.log('## step: idempotent consultation');
			const consultA1 = await request(
				b.baseUrl,
				'POST',
				`/api/reports/${reportAId}/consultation`,
				{ jar: jarA },
			);
			expectStatus('consultation A', consultA1, 200);
			const consultAt = consultA1.json.report.consultationRequestedAt;
			assert.match(consultAt, ISO_RE);
			const consultA2 = await request(
				b.baseUrl,
				'POST',
				`/api/reports/${reportAId}/consultation`,
				{ jar: jarA },
			);
			expectStatus('consultation A repeat', consultA2, 200);
			assert.equal(
				consultA2.json.report.consultationRequestedAt,
				consultAt,
				'consultation is idempotent',
			);

			console.log(
				'## step: owner B signup (en, other) and second journey',
			);
			const signupB = await request(
				b.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_B,
					jar: jarB,
				},
			);
			expectStatus('signup B', signupB, 201);
			assert.equal(
				signupB.json.user.profile.otherBusinessType,
				'Backcountry snowshoe guides',
			);
			assert.equal(signupB.json.user.profile.phone, null);
			assert.equal(signupB.json.user.profile.website, null);
			assert.equal(signupB.json.user.profile.note, null);
			const startB = await request(
				b.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					jar: jarB,
					body: { consent: true, mode: 'demo' },
				},
			);
			expectStatus('start B', startB, 201);
			assert.equal(startB.json.interview.mode, 'demo');
			const completeB = await request(
				b.baseUrl,
				'POST',
				`/api/interviews/${startB.json.interview.id}/complete`,
				{ jar: jarB, body: { transcript: TRANSCRIPT_B } },
			);
			expectStatus('complete B', completeB, 200);
			const reportBId = completeB.json.reportId;
			await pollUntil('report B ready', async () => {
				const response = await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportBId}`,
					{ jar: jarB, origin: null },
				);
				expectStatus('report B detail', response, 200);
				return response.json.report.status === 'ready' ?
						response
					:	null;
			});
			const contentBCheck = await request(
				b.baseUrl,
				'GET',
				`/api/reports/${reportBId}`,
				{ jar: jarB, origin: null },
			);
			assert.match(contentBCheck.json.report.content, /Birch Snow Tours/);
			assert.match(
				contentBCheck.json.report.content,
				/Automated draft \(rule-based\)/,
			);

			console.log('## step: other owners get 404, never leakage');
			for (const [label, pathName] of Object.entries({
				detail: `/api/reports/${reportAId}`,
				download: `/api/reports/${reportAId}/download`,
			})) {
				expectErrorCode(
					`owner B ${label} of A report`,
					await request(b.baseUrl, 'GET', pathName, {
						jar: jarB,
						origin: null,
					}),
					'not_found',
				);
			}
			expectErrorCode(
				'owner B consultation on A report',
				await request(
					b.baseUrl,
					'POST',
					`/api/reports/${reportAId}/consultation`,
					{ jar: jarB },
				),
				'not_found',
			);
			expectErrorCode(
				'unknown report detail',
				await request(
					b.baseUrl,
					'GET',
					`/api/reports/${crypto.randomUUID()}`,
					{
						jar: jarA,
						origin: null,
					},
				),
				'not_found',
			);

			console.log('## step: staff provisioning, login and role walls');
			const loginStaff = await request(
				b.baseUrl,
				'POST',
				'/api/auth/login',
				{
					jar: jarStaff,
					body: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
				},
			);
			expectStatus('login staff', loginStaff, 200);
			assert.equal(loginStaff.json.user.role, 'staff');
			assert.equal(loginStaff.json.user.profile.email, STAFF_EMAIL);
			assert.equal(loginStaff.json.user.profile.name, 'staff');
			expectErrorCode(
				'staff cannot start interview',
				await request(b.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarStaff,
					body: { consent: true, mode: 'demo' },
				}),
				'forbidden',
			);
			expectErrorCode(
				'staff cannot request consultation',
				await request(
					b.baseUrl,
					'POST',
					`/api/reports/${reportAId}/consultation`,
					{ jar: jarStaff },
				),
				'forbidden',
			);
			const staffDetailA = await request(
				b.baseUrl,
				'GET',
				`/api/reports/${reportAId}`,
				{ jar: jarStaff, origin: null },
			);
			expectStatus('staff sees report A', staffDetailA, 200);
			expectStatus(
				'staff download A',
				await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportAId}/download`,
					{ jar: jarStaff, origin: null },
				),
				200,
			);

			console.log('## step: staff queue across owners, newest first');
			const staffList1 = await request(
				b.baseUrl,
				'GET',
				'/api/staff/reports',
				{
					jar: jarStaff,
					origin: null,
				},
			);
			expectStatus('staff reports', staffList1, 200);
			assert.match(staffList1.headers.get('cache-control'), /no-store/);
			assert.equal(staffList1.json.reports.length, 2);
			const [summaryB, summaryA] = staffList1.json.reports;
			assert.equal(summaryB.id, reportBId);
			assert.equal(summaryA.id, reportAId);
			assert.equal(summaryB.ownerEmail, 'owner-b@example.test');
			assert.equal(summaryB.ownerName, 'John Birch');
			assert.equal(summaryB.businessName, 'Birch Snow Tours');
			assert.equal(summaryB.locale, 'en');
			assert.equal(summaryA.ownerName, '田中 花子');
			assert.equal(summaryA.consultationRequestedAt, consultAt);
			assert.equal(summaryB.consultationRequestedAt, null);
			for (const summary of [summaryA, summaryB]) {
				assert.match(summary.createdAt, ISO_RE);
				assert.equal(summary.status, 'ready');
				assert.match(summary.ownerId, /^[0-9a-f-]{36}$/);
			}

			console.log(
				'## step: owner C interview expiry via synthetic data edit',
			);
			const signupC = await request(
				b.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_C,
					jar: jarC,
				},
			);
			expectStatus('signup C', signupC, 201);
			const startC1 = await request(
				b.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					jar: jarC,
					body: { consent: true, mode: 'demo' },
				},
			);
			expectStatus('start C', startC1, 201);
			const expiredInterviewId = startC1.json.interview.id;
			withDb((db) => {
				db.prepare(
					"UPDATE interviews SET deadline_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
				).run(expiredInterviewId);
			});
			const currentC1 = await request(
				b.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar: jarC, origin: null },
			);
			expectStatus('current after expiry', currentC1, 200);
			assert.equal(currentC1.json.interview, null);
			assert.equal(currentC1.json.reportId, null);
			expectErrorCode(
				'complete expired interview',
				await request(
					b.baseUrl,
					'POST',
					`/api/interviews/${expiredInterviewId}/complete`,
					{ jar: jarC, body: { transcript: TRANSCRIPT_C } },
				),
				'interview_expired',
			);
			const startC2 = await request(
				b.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					jar: jarC,
					body: { consent: true, mode: 'demo' },
				},
			);
			expectStatus('start C after expiry', startC2, 201);
			assert.notEqual(startC2.json.interview.id, expiredInterviewId);
			const completeC = await request(
				b.baseUrl,
				'POST',
				`/api/interviews/${startC2.json.interview.id}/complete`,
				{ jar: jarC, body: { transcript: TRANSCRIPT_C } },
			);
			expectStatus('complete C', completeC, 200);
			const reportCId = completeC.json.reportId;
			await pollUntil('report C ready', async () => {
				const response = await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportCId}`,
					{ jar: jarC, origin: null },
				);
				expectStatus('report C detail', response, 200);
				return response.json.report.status === 'ready' ?
						response
					:	null;
			});

			console.log('## step: session expiry via synthetic data edit');
			withDb((db) => {
				db.prepare(
					"UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = 'owner-a@example.test')",
				).run();
			});
			const sessionExpired = await request(
				b.baseUrl,
				'GET',
				'/api/auth/session',
				{ jar: jarA, origin: null },
			);
			expectStatus('session after expiry edit', sessionExpired, 200);
			assert.equal(sessionExpired.json.user, null);
			expectErrorCode(
				'current after session expiry',
				await request(b.baseUrl, 'GET', '/api/interviews/current', {
					jar: jarA,
					origin: null,
				}),
				'unauthorized',
			);
			const loginA2 = await request(
				b.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					jar: jarA,
					body: { email: OWNER_A.email, password: OWNER_A.password },
				},
			);
			expectStatus('login A after expiry', loginA2, 200);

			console.log('## step: logout idempotency');
			const logoutC = await request(
				b.baseUrl,
				'POST',
				'/api/auth/logout',
				{
					jar: jarC,
				},
			);
			expectStatus('logout C', logoutC, 200);
			assert.equal(logoutC.json.user, null);
			const sessionCAfter = await request(
				b.baseUrl,
				'GET',
				'/api/auth/session',
				{ jar: jarC, origin: null },
			);
			assert.equal(sessionCAfter.json.user, null);
			expectStatus(
				'logout without session',
				await request(b.baseUrl, 'POST', '/api/auth/logout', {
					jar: jarC,
				}),
				200,
			);

			console.log(
				'## step: outbox notifications (owner + staff, stable files)',
			);
			await pollUntil('outbox rows all sent', async () => {
				const rows = withDb((db) =>
					db
						.prepare(
							'SELECT id, report_id, audience, recipient, subject, body, provider, status, sent_at FROM mail_outbox ORDER BY created_at',
						)
						.all(),
				);
				return (
						rows.length === 6
							&& rows.every((row) => row.status === 'sent')
					) ?
						rows
					:	null;
			});
			const outboxRows = withDb((db) =>
				db
					.prepare(
						'SELECT id, report_id, audience, recipient, subject, body, provider, status, sent_at FROM mail_outbox ORDER BY created_at',
					)
					.all(),
			);
			const mailDir = path.join(dataDir, 'mail-outbox');
			const files1 = fs.readdirSync(mailDir).sort();
			await sleep(1600);
			const files2 = fs.readdirSync(mailDir).sort();
			assert.deepEqual(files2, files1, '.eml filenames must stay stable');
			assert.equal(files1.length, 6);
			for (const row of outboxRows) {
				assert.equal(row.provider, 'local');
				assert.equal(row.status, 'sent');
				assert.match(row.sent_at, ISO_RE);
				const file = path.join(mailDir, `${row.id}.eml`);
				assert.equal(fs.existsSync(file), true, `missing ${file}`);
				const eml = fs.readFileSync(file, 'utf8');
				assert.match(eml, new RegExp(`^To: ${row.recipient}$`, 'm'));
				assert.match(eml, /^From: /m);
				assert.match(eml, /^Date: /m);
				assert.ok(eml.includes(row.subject), 'subject present in .eml');
				assert.ok(eml.includes(row.body), 'body present in .eml');
			}
			const ownerMails = outboxRows.filter(
				(row) => row.audience === 'owner',
			);
			const staffMails = outboxRows.filter(
				(row) => row.audience === 'staff',
			);
			assert.equal(ownerMails.length, 3);
			assert.equal(staffMails.length, 3);
			for (const row of [...ownerMails, ...staffMails]) {
				assert.ok(
					row.body.includes(`${PUBLIC_LINK(row.report_id)}`),
					'mail body contains the protected report link',
				);
				assert.doesNotMatch(
					row.body,
					/客室は12室あります|green season has almost no customers/,
					'mail must never leak transcript excerpts',
				);
			}
			const mailA = ownerMails.find((row) => row.report_id === reportAId);
			assert.equal(mailA.recipient, 'owner-a@example.test');
			assert.ok(mailA.subject.includes('湯の花旅館'));
			assert.ok(mailA.body.includes('レポート'));
			const mailB = ownerMails.find((row) => row.report_id === reportBId);
			assert.equal(mailB.recipient, 'owner-b@example.test');
			assert.ok(mailB.subject.includes('Birch Snow Tours'));
			assert.ok(mailB.subject.includes('report is ready'));
			assert.ok(mailB.body.includes('is ready'));
			const staffMailA = staffMails.find(
				(row) => row.report_id === reportAId,
			);
			assert.equal(staffMailA.recipient, STAFF_EMAIL);
			assert.equal(
				staffMailA.body.includes(`/reports/${reportAId}`),
				true,
			);
			assert.ok(
				staffMailA.subject.includes(OWNER_A.profile.businessName),
				'staff ready mail subject names the business',
			);
			assert.ok(
				staffMailA.body.includes(OWNER_A.profile.businessName),
				'staff ready mail body names the business',
			);
			const dupCheck = withDb((db) =>
				db
					.prepare(
						'SELECT report_id, audience, recipient, COUNT(*) AS n FROM mail_outbox GROUP BY report_id, audience, recipient HAVING n > 1',
					)
					.all(),
			);
			assert.equal(
				dupCheck.length,
				0,
				'unique (report, audience, recipient) keys',
			);

			console.log('## step: failed report path via synthetic data edit');
			const savedC = withDb((db) =>
				db
					.prepare('SELECT status, content FROM reports WHERE id = ?')
					.get(reportCId),
			);
			withDb((db) => {
				db.prepare(
					"UPDATE reports SET status = 'failed', content = NULL, failure_reason = 'synthetic QA failure' WHERE id = ?",
				).run(reportCId);
			});
			const failedDetail = await request(
				b.baseUrl,
				'GET',
				`/api/reports/${reportCId}`,
				{ jar: jarStaff, origin: null },
			);
			expectStatus('failed detail', failedDetail, 200);
			assert.equal(failedDetail.json.report.status, 'failed');
			assert.equal(failedDetail.json.report.content, null);
			assert.equal(
				failedDetail.json.report.failureReason,
				'synthetic QA failure',
			);
			expectErrorCode(
				'download failed report',
				await request(
					b.baseUrl,
					'GET',
					`/api/reports/${reportCId}/download`,
					{ jar: jarStaff, origin: null },
				),
				'not_ready',
			);
			withDb((db) => {
				db.prepare(
					"UPDATE reports SET status = 'ready', content = ?, failure_reason = NULL WHERE id = ?",
				).run(savedC.content, reportCId);
			});

			console.log('## step: cleanup server B');
			await running[running.length - 1].close();
		} finally {
			for (const entry of running.splice(0)) {
				await entry.close();
			}
			// Temp directory hygiene: also clean up when the test failed, so
			// failed runs do not leak .data/test state.
			try {
				cleanupDataDir();
			} catch (error) {
				console.error('## cleanupDataDir failed:', error);
			}
		}

		function PUBLIC_LINK(reportId) {
			return `/reports/${reportId}`;
		}
	},
);

test(
	'staff roster revocation: sessions, login and notification recipients',
	{ timeout: 180000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run a build first`,
		);

		const dataDirStaff = path.join(
			repoRoot,
			'.data',
			'test',
			`staff-roster-${process.pid}`,
		);
		removeDir(dataDirStaff);

		const running = [];
		try {
			// Phase 1 — roster includes the extra staff address.
			const first = await startJourneyServer({
				label: 'roster server 1',
				dataDir: dataDirStaff,
				staffEmails: `${STAFF_EMAIL},${EXTRA_STAFF_EMAIL}`,
				staffPassword: STAFF_PASSWORD,
			});
			running.push(first);

			const jarD = newCookieJar();
			const signupD = await request(
				first.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_D,
					jar: jarD,
				},
			);
			expectStatus('signup owner D', signupD, 201);
			const startD = await request(
				first.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar: jarD, body: { consent: true, mode: 'demo' } },
			);
			expectStatus('start D', startD, 201);
			const completeD = await request(
				first.baseUrl,
				'POST',
				`/api/interviews/${startD.json.interview.id}/complete`,
				{ jar: jarD, body: { transcript: TRANSCRIPT_A } },
			);
			expectStatus('complete D', completeD, 200);
			const reportDId = completeD.json.reportId;
			await pollUntil('report D ready', async () => {
				const response = await request(
					first.baseUrl,
					'GET',
					`/api/reports/${reportDId}`,
					{ jar: jarD, origin: null },
				);
				return response.json?.report?.status === 'ready' ?
						response
					:	null;
			});

			// Both configured staff addresses are recipients while on roster.
			const recipientsD = new Set(
				withDb(
					(db) =>
						db
							.prepare(
								'SELECT audience, recipient FROM mail_outbox WHERE report_id = ?',
							)
							.all(reportDId),
					dataDirStaff,
				).map((row) => `${row.audience}:${row.recipient}`),
			);
			assert.ok(
				recipientsD.has(`staff:${STAFF_EMAIL}`)
					&& recipientsD.has(`staff:${EXTRA_STAFF_EMAIL}`),
				`both staff recipients expected, got ${[...recipientsD].join(', ')}`,
			);

			// The extra staff account can log in while it is on the roster.
			const jarExtra = newCookieJar();
			const loginExtra = await request(
				first.baseUrl,
				'POST',
				'/api/auth/login',
				{
					jar: jarExtra,
					body: {
						email: EXTRA_STAFF_EMAIL,
						password: STAFF_PASSWORD,
					},
				},
			);
			expectStatus('login extra staff (on roster)', loginExtra, 200);

			// Owner E: second report so phase 2 can prove recipient gating.
			const jarE = newCookieJar();
			const signupE = await request(
				first.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_E,
					jar: jarE,
				},
			);
			expectStatus('signup owner E', signupE, 201);
			const startE = await request(
				first.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar: jarE, body: { consent: true, mode: 'demo' } },
			);
			expectStatus('start E', startE, 201);
			const completeE = await request(
				first.baseUrl,
				'POST',
				`/api/interviews/${startE.json.interview.id}/complete`,
				{ jar: jarE, body: { transcript: TRANSCRIPT_B } },
			);
			expectStatus('complete E', completeE, 200);
			const reportEId = completeE.json.reportId;
			await pollUntil('report E ready', async () => {
				const response = await request(
					first.baseUrl,
					'GET',
					`/api/reports/${reportEId}`,
					{ jar: jarE, origin: null },
				);
				return response.json?.report?.status === 'ready' ?
						response
					:	null;
			});

			// Partial UNIQUE index: exactly one submitted interview per owner.
			const uniqueIndex = withDb(
				(db) =>
					db
						.prepare(
							"SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_interviews_owner_submitted'",
						)
						.get(),
				dataDirStaff,
			);
			assert.ok(uniqueIndex, 'partial unique index must exist');
			assert.match(uniqueIndex.sql, /UNIQUE/);
			assert.throws(
				() =>
					withDb(
						(db) =>
							db
								.prepare(
									"INSERT INTO interviews (id, owner_id, mode, status, consent_at, started_at, deadline_at, submitted_at, transcript, created_at) VALUES ('synthetic-dup', ?, 'demo', 'submitted', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-01T01:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z')",
								)
								.run(signupE.json.user.id),
						dataDirStaff,
					),
				/UNIQUE/i,
				'a second submitted interview for the same owner must be rejected',
			);

			await running[running.length - 1].close();

			// Phase 2 — same data dir, roster no longer lists the extra staff.
			const second = await startJourneyServer({
				label: 'roster server 2',
				dataDir: dataDirStaff,
				staffEmails: STAFF_EMAIL,
				staffPassword: STAFF_PASSWORD,
			});
			running.push(second);

			// The revoked staff member's row, sessions and login are gone.
			const extraUser = withDb(
				(db) =>
					db
						.prepare('SELECT id, role FROM users WHERE email = ?')
						.get(EXTRA_STAFF_EMAIL),
				dataDirStaff,
			);
			assert.equal(
				extraUser,
				undefined,
				'revoked staff user row must be removed',
			);
			const staffRows = withDb(
				(db) =>
					db
						.prepare(
							"SELECT email FROM users WHERE role = 'staff' ORDER BY email",
						)
						.all(),
				dataDirStaff,
			).map((row) => row.email);
			assert.deepEqual(
				staffRows,
				[STAFF_EMAIL],
				'only rostered staff rows remain',
			);
			const sessionNull = await request(
				second.baseUrl,
				'GET',
				'/api/auth/session',
				{ jar: jarExtra, origin: null },
			);
			expectStatus('revoked staff session', sessionNull, 200);
			assert.equal(
				sessionNull.json.user,
				null,
				'revoked staff session must no longer authenticate',
			);
			const loginRevoked = await request(
				second.baseUrl,
				'POST',
				'/api/auth/login',
				{
					body: {
						email: EXTRA_STAFF_EMAIL,
						password: STAFF_PASSWORD,
					},
				},
			);
			expectStatus('login revoked staff', loginRevoked, 401);
			expectErrorCode(
				'login revoked staff',
				loginRevoked,
				'invalid_credentials',
			);

			// The still-rostered staff member keeps working.
			const jarStaff2 = newCookieJar();
			const loginStaff2 = await request(
				second.baseUrl,
				'POST',
				'/api/auth/login',
				{
					jar: jarStaff2,
					body: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
				},
			);
			expectStatus('login rostered staff', loginStaff2, 200);

			// New notifications no longer reach the revoked address.
			const jarF = newCookieJar();
			const signupF = await request(
				second.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_F,
					jar: jarF,
				},
			);
			expectStatus('signup owner F', signupF, 201);
			const startF = await request(
				second.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar: jarF, body: { consent: true, mode: 'demo' } },
			);
			expectStatus('start F', startF, 201);
			const completeF = await request(
				second.baseUrl,
				'POST',
				`/api/interviews/${startF.json.interview.id}/complete`,
				{ jar: jarF, body: { transcript: TRANSCRIPT_C } },
			);
			expectStatus('complete F', completeF, 200);
			const reportFId = completeF.json.reportId;
			await pollUntil('report F ready', async () => {
				const response = await request(
					second.baseUrl,
					'GET',
					`/api/reports/${reportFId}`,
					{ jar: jarF, origin: null },
				);
				return response.json?.report?.status === 'ready' ?
						response
					:	null;
			});
			const recipientsF = withDb(
				(db) =>
					db
						.prepare(
							'SELECT audience, recipient FROM mail_outbox WHERE report_id = ?',
						)
						.all(reportFId),
				dataDirStaff,
			).map((row) => `${row.audience}:${row.recipient}`);
			assert.deepEqual(
				recipientsF.sort(),
				[`owner:${OWNER_F.email}`, `staff:${STAFF_EMAIL}`],
				'revoked staff address must not be a notification recipient',
			);

			// A revoked staff email is freed up for owner signup again.
			const signupRevokedEmail = await request(
				second.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: {
						...OWNER_F,
						email: EXTRA_STAFF_EMAIL,
						profile: { ...OWNER_F.profile, name: 'Reborn Owner' },
					},
				},
			);
			expectStatus(
				'signup with revoked staff email',
				signupRevokedEmail,
				201,
			);
			assert.equal(signupRevokedEmail.json.user.role, 'owner');
		} finally {
			for (const entry of running.splice(0)) {
				await entry.close();
			}
			try {
				removeDir(dataDirStaff);
			} catch (error) {
				console.error('## removeDir failed:', error);
			}
		}
	},
);

test(
	'canonical origin policy, Secure cookies and live mode rejection',
	{ timeout: 180000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run a build first`,
		);

		const dataDirOrigin = path.join(
			repoRoot,
			'.data',
			'test',
			`origin-policy-${process.pid}`,
		);
		removeDir(dataDirOrigin);

		const running = [];
		try {
			const server = await startJourneyServer({
				label: 'origin-policy server',
				dataDir: dataDirOrigin,
				staffEmails: STAFF_EMAIL,
				staffPassword: STAFF_PASSWORD,
				extraEnv: {
					// PUBLIC_BASE_URL claims an https origin the server does not
					// itself serve — the canonical config must drive both the
					// write-origin check and the Secure cookie attribute.
					PUBLIC_BASE_URL: CANONICAL_ORIGIN,
					// Integration values are set: without a configured agent the
					// live interview surface still refuses to start (honest
					// unavailable state; no substitute surface is offered).
					INTEGRATION_BASE_URL: 'https://integration.example.test',
					INTEGRATION_TOKEN: 'demo-only-not-a-secret',
				},
			});
			running.push(server);
			const CANON = CANONICAL_ORIGIN;

			const jarG = newCookieJar();
			const signupG = await request(
				server.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER_D,
					jar: jarG,
					origin: CANON,
				},
			);
			expectStatus('signup with canonical origin', signupG, 201);
			const cookieG = signupG.setCookies[0];
			assert.match(cookieG, /^session=/);
			assert.match(cookieG, /HttpOnly/i);
			assert.match(cookieG, /SameSite=Lax/i);
			assert.match(
				cookieG,
				/Secure/i,
				'cookie must be Secure when PUBLIC_BASE_URL is https',
			);

			// Browser metadata that is not the canonical origin is rejected.
			expectErrorCode(
				'signup with non-canonical same-host origin',
				await request(server.baseUrl, 'POST', '/api/auth/signup', {
					body: OWNER_E,
					origin: server.baseUrl,
				}),
				'forbidden',
			);
			expectErrorCode(
				'signup with evil origin',
				await request(server.baseUrl, 'POST', '/api/auth/signup', {
					body: OWNER_E,
					origin: 'https://evil.example',
				}),
				'forbidden',
			);

			// Intentional headerless test clients still pass writes.
			const loginG = await request(
				server.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					jar: jarG,
					body: { email: OWNER_D.email, password: OWNER_D.password },
				},
			);
			expectStatus('login without origin header', loginG, 200);

			// Live start is still refused with integration values set: the
			// gate is the agent configuration, not those values.
			expectErrorCode(
				'start live with integration env set',
				await request(server.baseUrl, 'POST', '/api/interviews/start', {
					jar: jarG,
					origin: CANON,
					body: { consent: true, mode: 'live' },
				}),
				'mode_unavailable',
			);
			const startG = await request(
				server.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					jar: jarG,
					origin: CANON,
					body: { consent: true, mode: 'demo' },
				},
			);
			expectStatus('start demo with integration env set', startG, 201);
			const completeG = await request(
				server.baseUrl,
				'POST',
				`/api/interviews/${startG.json.interview.id}/complete`,
				{
					jar: jarG,
					origin: CANON,
					body: { transcript: TRANSCRIPT_A },
				},
			);
			expectStatus('complete G', completeG, 200);
			const reportGId = completeG.json.reportId;
			await pollUntil('report G ready', async () => {
				const response = await request(
					server.baseUrl,
					'GET',
					`/api/reports/${reportGId}`,
					{ jar: jarG, origin: null },
				);
				return response.json?.report?.status === 'ready' ?
						response
					:	null;
			});
			const mailG = withDb(
				(db) =>
					db
						.prepare(
							'SELECT recipient, body FROM mail_outbox WHERE report_id = ? AND audience = ?',
						)
						.get(reportGId, 'owner'),
				dataDirOrigin,
			);
			assert.equal(mailG.recipient, OWNER_D.email);
			assert.ok(
				mailG.body.includes(`${CANON}/reports/${reportGId}`),
				'mail link must use the canonical PUBLIC_BASE_URL',
			);

			// Login revokes the previously presented session (rotation).
			const tokenBefore = jarG.map.get('session');
			const sessionsBefore = withDb(
				(db) =>
					db
						.prepare(
							'SELECT token_hash FROM sessions WHERE user_id = ?',
						)
						.all(signupG.json.user.id),
				dataDirOrigin,
			);
			assert.equal(sessionsBefore.length, 1);
			const relogin = await request(
				server.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					jar: jarG,
					body: { email: OWNER_D.email, password: OWNER_D.password },
				},
			);
			expectStatus('re-login rotates session', relogin, 200);
			const tokenAfter = jarG.map.get('session');
			assert.notEqual(tokenAfter, tokenBefore);
			const sessionsAfter = withDb(
				(db) =>
					db
						.prepare(
							'SELECT token_hash FROM sessions WHERE user_id = ?',
						)
						.all(signupG.json.user.id),
				dataDirOrigin,
			);
			assert.equal(
				sessionsAfter.length,
				1,
				'old presented session must be revoked, not accumulated',
			);
			assert.equal(sessionsAfter[0].token_hash, sha256HexOf(tokenAfter));

			// Stale (already expired) sessions are purged where easy.
			withDb(
				(db) =>
					db
						.prepare(
							"INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('stale-expired-token-hash', ?, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')",
						)
						.run(signupG.json.user.id),
				dataDirOrigin,
			);
			const sessionsWithStale = withDb(
				(db) =>
					db
						.prepare(
							'SELECT token_hash FROM sessions WHERE user_id = ?',
						)
						.all(signupG.json.user.id),
				dataDirOrigin,
			);
			assert.equal(sessionsWithStale.length, 2);
			const thirdLogin = await request(
				server.baseUrl,
				'POST',
				'/api/auth/login',
				{
					origin: null,
					jar: jarG,
					body: { email: OWNER_D.email, password: OWNER_D.password },
				},
			);
			expectStatus('login purges stale sessions', thirdLogin, 200);
			const sessionsPurged = withDb(
				(db) =>
					db
						.prepare(
							'SELECT token_hash FROM sessions WHERE user_id = ?',
						)
						.all(signupG.json.user.id),
				dataDirOrigin,
			);
			assert.equal(
				sessionsPurged.length,
				1,
				'expired session rows must be purged',
			);
			assert.notEqual(
				sessionsPurged[0].token_hash,
				'stale-expired-token-hash',
			);
		} finally {
			for (const entry of running.splice(0)) {
				await entry.close();
			}
			try {
				removeDir(dataDirOrigin);
			} catch (error) {
				console.error('## removeDir failed:', error);
			}
		}
	},
);

test(
	'npm start binds loopback by default and respects explicit HOST',
	{
		timeout: 120000,
	},
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run a build first`,
		);
		const dataDirBind = path.join(
			repoRoot,
			'.data',
			'test',
			`start-bind-${process.pid}`,
		);
		removeDir(dataDirBind);

		const pkg = JSON.parse(
			fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
		);
		const startScript = pkg.scripts?.start ?? '';
		const words = startScript.split(/\s+/).filter(Boolean);
		assert.equal(words[0], 'node', 'start must run node');
		const spawnEnv = (overrides) => {
			const env = { ...process.env };
			delete env.HOST;
			delete env.NITRO_HOST;
			return { ...env, ...overrides };
		};
		const running = [];
		const runServer = async (label, overrides) => {
			const port = await freePort();
			const child = spawn(process.execPath, words.slice(1), {
				cwd: repoRoot,
				env: spawnEnv({
					PORT: String(port),
					DATA_DIR: dataDirBind,
					PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
					WORKER_POLL_MS: '60000',
					...overrides,
				}),
				stdio: ['ignore', 'inherit', 'inherit'],
			});
			const entry = {
				close: async () => {
					child.kill();
					await pollUntil(
						`${label} exit`,
						async () =>
							child.exitCode !== null
							|| child.signalCode !== null,
						10000,
						100,
					);
					const index = running.indexOf(entry);
					if (index >= 0) {
						running.splice(index, 1);
					}
				},
			};
			running.push(entry);
			const probeHost =
				overrides.HOST && overrides.HOST !== '0.0.0.0' ?
					overrides.HOST
				:	'127.0.0.1';
			const baseUrl = `http://${probeHost}:${port}`;
			await pollUntil(`${label} ready`, async () => {
				const probe = await request(baseUrl, 'GET', '/', {
					origin: null,
				});
				return probe.status === 200;
			});
			const addresses = listeningAddresses(child.pid);
			assert.ok(
				addresses.length > 0,
				`no listening TCP row found for pid ${child.pid} — netstat parsing failed`,
			);
			return { port, addresses, close: entry.close };
		};

		try {
			// Default: no HOST/NITRO_HOST — the server must bind loopback only.
			const defaulted = await runServer('loopback-default server', {});
			const { port, addresses } = defaulted;
			assert.ok(
				addresses.some((address) => address === `127.0.0.1:${port}`),
				`expected a 127.0.0.1 listener, got ${addresses.join(', ')}`,
			);
			assert.equal(
				addresses.filter((address) => address !== `127.0.0.1:${port}`)
					.length,
				0,
				`server must not listen beyond loopback by default, got ${addresses.join(', ')}`,
			);
			await defaulted.close();

			// Explicit HOST is respected verbatim.
			let explicitHost = '0.0.0.0';
			for (const list of Object.values(os.networkInterfaces())) {
				for (const entry of list ?? []) {
					if (entry.family === 'IPv4' && !entry.internal) {
						explicitHost = entry.address;
					}
				}
			}
			const explicit = await runServer('explicit-host server', {
				HOST: explicitHost,
			});
			assert.ok(
				explicit.addresses.some((address) =>
					address.endsWith(`:${explicit.port}`),
				),
				`expected a listener on ${explicitHost}, got ${explicit.addresses.join(', ')}`,
			);
			assert.ok(
				explicit.addresses.every((address) =>
					address.startsWith(`${explicitHost}:`),
				),
				`explicit HOST must be respected verbatim, got ${explicit.addresses.join(', ')}`,
			);
			await explicit.close();

			// The start script must route through the loopback-default wrapper.
			assert.match(
				startScript,
				/scripts[\\/]start\.mjs/,
				`start script must use the wrapper, got "${startScript}"`,
			);
		} finally {
			for (const entry of running.splice(0)) {
				await entry.close();
			}
			try {
				removeDir(dataDirBind);
			} catch (error) {
				console.error('## removeDir failed:', error);
			}
		}
	},
);
