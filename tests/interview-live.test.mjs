// Live interview journey: the embedded-agent surface, exercised through the
// real endpoints with loopback stubs. Proves the webhook association (the
// transcript reaches the right interview through the server-issued interview
// id dynamic variable, even replayed), the honest states (no Dify key → the
// assessment is failed, not "preparing" forever; research stack absent →
// the research surface stays idle), and the full Dify report path when the
// stack is configured. No HTTP test backdoors: lifecycle details are read
// from the synthetic SQLite data directly.
// Run: node --test tests/interview-live.test.mjs   (needs `npm run build`)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
);
const serverEntry =
	process.env.OKAMI_TEST_SERVER_ENTRY
	|| path.join(repoRoot, '.output', 'server', 'index.mjs');

const AGENT_ENV = {
	ELEVENLABS_API_KEY: 'ek_test_stubbed',
	ELEVENLABS_AGENT_ID: 'agent_stub',
	ELEVENLABS_WEBHOOK_SECRET: 'whsec_test',
};

const FULL_ENV = {
	...AGENT_ENV,
	RESEARCH_TOOL_SECRET: 'tool_test_secret',
	LINKUP_API_KEY: 'linkup_test_key',
	DIFY_API_KEY: 'dify_test_key',
};

const OWNER_A = {
	email: 'live-owner@example.test',
	password: 'live-owner-pass-1234',
	profile: {
		name: '山田 花子',
		businessName: '湯の花旅館',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};

const RESEARCH_CASES = [
	{
		title: 'LINE mini app group bookings',
		company: 'Otaru Izakaya Kita',
		problem: 'Weekday evening cancellations left seats empty',
		solution: 'LINE mini app group booking with deposit prepayment',
		outcome: 'Cancellation rate dropped by about 30 percent',
		applicability: 'Fits small restaurants with repeat groups',
		cost_complexity: 'Low cost, moderate setup effort',
		source_urls: ['https://example.test/izakaya-line-booking'],
	},
];

const EXPECTED_CASES = [
	{
		title: 'LINE mini app group bookings',
		company: 'Otaru Izakaya Kita',
		problem: 'Weekday evening cancellations left seats empty',
		solution: 'LINE mini app group booking with deposit prepayment',
		outcome: 'Cancellation rate dropped by about 30 percent',
		applicability: 'Fits small restaurants with repeat groups',
		costComplexity: 'Low cost, moderate setup effort',
		sourceUrls: ['https://example.test/izakaya-line-booking'],
	},
];

const ASSESSMENT_REPORT =
	'# 経営相談レポート（デモ）: 湯の花旅館\n\nAI下書き（Dify）';

const DEEP_RESEARCH_DOSSIER = {
	answer: '# 深掘り調査デモ\n\nシフト作成には週3時間かかる。',
	sources: [
		{ name: 'Deep pass source', url: 'https://example.test/deep-pass' },
	],
};

const TRANSCRIPT_TURNS = [
	{
		role: 'agent',
		message: 'こんにちは。シマ エナガと申します。はじめにお伝えします。私は人ではなく、AI、つまりコンピューターの声です。',
	},
	{ role: 'user', message: 'こんにちは。旅館のことを話します。' },
	{
		role: 'agent',
		message: 'まず、いま一番大変なことは何ですか。',
	},
	{
		role: 'user',
		message: '従業員が足りなくて、予約を手で写しています。',
	},
];

const dataDir = path.join(
	repoRoot,
	'.data',
	'test',
	`interview-live-${process.pid}`,
);

function cleanupDataDir() {
	removeDir(dataDir);
}

cleanupDataDir();

function removeDir(dir) {
	let lastError = null;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			lastError = error;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
		}
	}
	throw lastError;
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
		// Non-JSON body stays null.
	}
	return {
		status: response.status,
		headers: response.headers,
		text,
		json,
	};
}

async function requestRaw(baseUrl, pathName, headers, body) {
	const response = await fetch(`${baseUrl}${pathName}`, {
		method: 'POST',
		headers,
		body,
		redirect: 'manual',
	});
	const text = await response.text();
	let json = null;
	try {
		json = text.length > 0 ? JSON.parse(text) : null;
	} catch {
		// Non-JSON body stays null.
	}
	return { status: response.status, text, json };
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

async function pollUntil(label, fn, timeoutMs = 30000, intervalMs = 250) {
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

function withDb(dir, fn) {
	const db = new DatabaseSync(path.join(dir, 'app.db'));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function interviewRow(dir, interviewId) {
	return withDb(dir, (db) =>
		db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId),
	);
}

function signWebhook(
	raw,
	timestampSeconds,
	secret = AGENT_ENV.ELEVENLABS_WEBHOOK_SECRET,
) {
	const digest = crypto
		.createHmac('sha256', secret)
		.update(`${timestampSeconds}.`)
		.update(raw)
		.digest('hex');
	return `t=${timestampSeconds},v0=${digest}`;
}

/** A post-call payload for a live interview (matched by interview id). */
function postCallBody(interviewId, extraData = {}) {
	return Buffer.from(
		JSON.stringify({
			type: 'post_call_transcription',
			data: {
				agent_id: AGENT_ENV.ELEVENLABS_AGENT_ID,
				conversation_id: 'conv_live_1',
				transcript: TRANSCRIPT_TURNS,
				conversation_initiation_client_data: {
					dynamic_variables: {
						interview_id: interviewId,
						web_business_context:
							'{"business_name":"湯の花旅館","location":"ニセコ町"}',
						web_intake_complete: true,
					},
				},
				...extraData,
			},
		}),
		'utf8',
	);
}

function signedPostCall(baseUrl, raw, secret) {
	return requestRaw(baseUrl, '/api/voice/elevenlabs/post-call', {
		'content-type': 'application/json',
		'elevenlabs-signature': signWebhook(
			raw,
			Math.floor(Date.now() / 1000),
			secret,
		),
	}, raw);
}

async function startInterviewServer({ label, dir, extraEnv = {} }) {
	const port = await freePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const env = {
		...process.env,
		PORT: String(port),
		HOST: '127.0.0.1',
		DATA_DIR: dir,
		PUBLIC_BASE_URL: baseUrl,
		STAFF_EMAILS: 'staff@example.test',
		STAFF_PASSWORD: 'staff-pass-1234',
		INTEGRATION_BASE_URL: '',
		INTEGRATION_TOKEN: '',
		CLOCK_OFFSET_MS: '',
		WORKER_POLL_MS: '50',
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

async function signupOwner(baseUrl, email) {
	const jar = newCookieJar();
	const response = await request(baseUrl, 'POST', '/api/auth/signup', {
		body: { ...OWNER_A, email },
		jar,
	});
	expectStatus(`signup ${email}`, response, 201);
	return jar;
}

test(
	'a live interview receives its transcript and shows the honest no-Dify state',
	{ timeout: 120000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const dir = path.join(dataDir, 'no-dify');
		fs.mkdirSync(dir, { recursive: true });
		const server = await startInterviewServer({
			label: 'live-no-dify',
			dir,
			extraEnv: AGENT_ENV,
		});
		try {
			const config = await request(
				server.baseUrl,
				'GET',
				'/api/voice/config',
				{ origin: null },
			);
			expectStatus('config', config, 200);
			assert.deepEqual(config.json, {
				available: false,
				agentAvailable: true,
				reportEngineAvailable: false,
				agentId: AGENT_ENV.ELEVENLABS_AGENT_ID,
			});

			const jar = await signupOwner(server.baseUrl, OWNER_A.email);

			// The retired voice-session API refuses new conversations.
			const voiceSession = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: true }, jar },
			);
			expectStatus('new voice session is refused', voiceSession, 410);
			expectErrorCode(
				'new voice session is refused',
				voiceSession,
				'superseded',
			);

			console.log('## step: live start records the consent and intake');
			const start = await request(
				server.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar, body: { consent: true, mode: 'live' } },
			);
			expectStatus('start live', start, 201);
			const interview = start.json.interview;
			assert.equal(interview.mode, 'live');
			assert.equal(interview.status, 'active');
			assert.match(interview.id, /^[0-9a-f-]{36}$/);
			// The research stack is not configured here: the surface is idle,
			// honestly — not "queued forever". No cases have been fetched.
			assert.deepEqual(interview.research, {
				status: 'idle',
				started: false,
				cases: [],
			});
			assert.deepEqual(interview.assessment, {
				status: 'idle',
				reportId: null,
			});

			const current1 = await request(
				server.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar, origin: null },
			);
			expectStatus('current after start', current1, 200);
			assert.equal(current1.json.interview.id, interview.id);
			assert.equal(current1.json.reportId, null);

			// The intake snapshot landed on the row for the report later.
			const row1 = interviewRow(dir, interview.id);
			assert.deepEqual(JSON.parse(row1.business_json), {
				businessName: '湯の花旅館',
				location: 'ニセコ町',
			});
			assert.equal(row1.report_language, 'ja');

			console.log('## step: the transcript lands through the webhook');
			const raw = postCallBody(interview.id);
			const delivered = await signedPostCall(server.baseUrl, raw);
			expectStatus('post-call signed', delivered, 200);
			assert.deepEqual(delivered.json, { received: true });

			const current2 = await request(
				server.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar, origin: null },
			);
			expectStatus('current after webhook', current2, 200);
			assert.equal(current2.json.interview.status, 'submitted');
			// Without DIFY_API_KEY the assessment is failed immediately, so
			// the site can show the honest unavailable state.
			assert.equal(current2.json.interview.assessment.status, 'failed');
			assert.equal(current2.json.reportId, null);

			const row2 = interviewRow(dir, interview.id);
			assert.equal(row2.status, 'submitted');
			assert.ok(row2.transcript, 'the transcript is stored');
			assert.match(row2.transcript, /予約を手で写しています/);
			assert.equal(row2.assessment_status, 'failed');

			console.log('## step: replays and unknown ids change nothing');
			const replay = await signedPostCall(server.baseUrl, raw);
			expectStatus('post-call replay', replay, 200);
			const row3 = interviewRow(dir, interview.id);
			assert.equal(row3.transcript, row2.transcript);

			const unknownRaw = Buffer.from(
				JSON.stringify({
					type: 'post_call_transcription',
					data: {
						agent_id: AGENT_ENV.ELEVENLABS_AGENT_ID,
						conversation_id: 'conv_live_2',
						transcript: TRANSCRIPT_TURNS,
						conversation_initiation_client_data: {
							dynamic_variables: {
								interview_id: crypto.randomUUID(),
							},
						},
					},
				}),
				'utf8',
			);
			const unknown = await signedPostCall(server.baseUrl, unknownRaw);
			expectStatus('post-call unknown interview', unknown, 200);
			assert.deepEqual(unknown.json, { received: true });

			const noIdRaw = Buffer.from(
				JSON.stringify({
					type: 'post_call_transcription',
					data: {
						agent_id: AGENT_ENV.ELEVENLABS_AGENT_ID,
						conversation_id: 'conv_live_3',
						transcript: TRANSCRIPT_TURNS,
					},
				}),
				'utf8',
			);
			const noId = await signedPostCall(server.baseUrl, noIdRaw);
			expectStatus('post-call without an interview id', noId, 200);
			assert.deepEqual(noId.json, { received: true });

			// A second start is blocked by the one-submitted-interview rule.
			const demoStart = await request(
				server.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar, body: { consent: true, mode: 'demo' } },
			);
			expectErrorCode('second start blocked', demoStart, 'already_submitted');
		} finally {
			await server.close();
		}
	},
);

test(
	'a stored live transcript drives the Dify assessment end to end',
	{ timeout: 180000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const dir = path.join(dataDir, 'dify');
		fs.mkdirSync(dir, { recursive: true });
		const stub = await startProviderStub();
		const server = await startInterviewServer({
			label: 'live-dify',
			dir,
			extraEnv: {
				...FULL_ENV,
				ELEVENLABS_API_BASE_URL: stub.baseUrl,
				LINKUP_API_BASE_URL: stub.baseUrl,
				DIFY_API_BASE_URL: stub.baseUrl,
			},
		});
		try {
			const jar = await signupOwner(server.baseUrl, OWNER_A.email);
			const start = await request(
				server.baseUrl,
				'POST',
				'/api/interviews/start',
				{ jar, body: { consent: true, mode: 'live' } },
			);
			expectStatus('start live', start, 201);
			const interview = start.json.interview;
			// The research stack is configured: the profile-intake research is
			// queued at start and the worker completes it.
			assert.equal(interview.research.status, 'queued');

			await pollUntil('interview research completed', async () => {
				const current = await request(
					server.baseUrl,
					'GET',
					'/api/interviews/current',
					{ jar, origin: null },
				);
				return current.json.interview?.research?.status === 'completed';
			});
			const cases = (
				await request(server.baseUrl, 'GET', '/api/interviews/current', {
					jar,
					origin: null,
				})
			).json.interview.research.cases;
			assert.deepEqual(cases, EXPECTED_CASES);

			console.log('## step: the webhook submits the interview');
			const raw = postCallBody(interview.id);
			const delivered = await signedPostCall(server.baseUrl, raw);
			expectStatus('post-call signed', delivered, 200);

			await pollUntil('assessment completed', async () => {
				const current = await request(
					server.baseUrl,
					'GET',
					'/api/interviews/current',
					{ jar, origin: null },
				);
				return (
					current.json.interview?.assessment?.status === 'completed'
					&& current.json.reportId !== null
				);
			}, 90_000);

			const current = await request(
				server.baseUrl,
				'GET',
				'/api/interviews/current',
				{ jar, origin: null },
			);
			assert.equal(current.json.interview.status, 'submitted');
			assert.equal(current.json.interview.assessment.status, 'completed');
			const reportId = current.json.reportId;

			console.log('## step: the Dify run carried the full evidence');
			assert.equal(stub.state.assessmentRequests.length, 1);
			assert.equal(
				stub.state.assessmentRequests[0].authorization,
				`Bearer ${FULL_ENV.DIFY_API_KEY}`,
			);
			const assessmentBody = JSON.parse(
				stub.state.assessmentRequests[0].body,
			);
			assert.equal(assessmentBody.response_mode, 'streaming');
			// The interview id, not a conversation id, travels as the user.
			assert.equal(assessmentBody.user, interview.id);
			assert.equal(assessmentBody.inputs.report_language, 'Japanese');
			assert.match(
				assessmentBody.inputs.transcript,
				/予約を手で写しています/,
			);
			assert.match(assessmentBody.inputs.business, /湯の花旅館/);
			const evidence = JSON.parse(assessmentBody.inputs.research_cases);
			assert.deepEqual(evidence.in_call_cases, EXPECTED_CASES);
			assert.match(evidence.deep_research_report.answer, /深掘り調査デモ/);

			withDb(dir, (db) => {
				const row = interviewRow(dir, interview.id);
				assert.equal(row.assessment_status, 'completed');
				assert.equal(row.assessment_report_id, reportId);
				assert.equal(row.research_status, 'completed');
				const report = db
					.prepare('SELECT * FROM reports WHERE id = ?')
					.get(reportId);
				assert.ok(report);
				assert.equal(report.interview_id, interview.id);
				assert.equal(report.voice_conversation_id, null);
				assert.equal(report.status, 'ready');
				// A Dify report must never carry the rule-based draft label.
				assert.equal(report.generator, 'dify');
				assert.equal(report.business_name, '湯の花旅館');
				assert.equal(report.locale, 'ja');
				const mails = db
					.prepare(
						'SELECT audience, recipient, status FROM mail_outbox WHERE report_id = ? ORDER BY audience',
					)
					.all(reportId)
					.map((entry) => ({ ...entry }));
				assert.deepEqual(mails, [
					{
						audience: 'owner',
						recipient: OWNER_A.email,
						status: 'sent',
					},
					{
						audience: 'staff',
						recipient: 'staff@example.test',
						status: 'sent',
					},
				]);
			});
		} finally {
			await server.close();
			stub.server.close();
		}
	},
);

/**
 * Loopback stub for the Linkup research API and the Dify workflow run.
 * The profile-intake research completes immediately with one case; the
 * post-call deep pass completes immediately with the dossier; the Dify run
 * streams the canned report on the first attempt.
 */
function startProviderStub() {
	const state = {
		researchRequests: [],
		assessmentRequests: [],
	};
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			const respond = (status, payload) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(payload));
			};
			const url = new URL(req.url, 'http://stub');
			if (url.pathname === '/v1/research' && req.method === 'POST') {
				const body = Buffer.concat(chunks).toString('utf8');
				state.researchRequests.push(body);
				let parsed = {};
				try {
					parsed = JSON.parse(body);
				} catch {
					// Malformed body: fall through to the in-call branch.
				}
				respond(
					200,
					parsed.reasoningDepth === 'XL' ?
						{ id: 'task_deep' }
					:	{ id: 'task_ok' },
				);
				return;
			}
			const pollMatch = /^\/v1\/research\/([^/]+)$/.exec(url.pathname);
			if (pollMatch && req.method === 'GET') {
				const taskId = decodeURIComponent(pollMatch[1]);
				if (taskId === 'task_ok') {
					respond(200, {
						status: 'completed',
						output: { cases: RESEARCH_CASES },
					});
				} else if (taskId === 'task_deep') {
					respond(200, {
						status: 'completed',
						output: DEEP_RESEARCH_DOSSIER,
					});
				} else {
					respond(500, { detail: 'unknown task' });
				}
				return;
			}
			if (url.pathname === '/v1/workflows/run' && req.method === 'POST') {
				state.assessmentRequests.push({
					authorization: req.headers.authorization ?? '',
					body: Buffer.concat(chunks).toString('utf8'),
				});
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(
					'data: {"event": "workflow_started", "data": {"id": "wfr_1"}}\n\n',
				);
				res.end(
					`data: {"event": "workflow_finished", "data": {"id": "wfr_1", "status": "succeeded", "outputs": {"report": ${JSON.stringify(ASSESSMENT_REPORT)}}}}\n\n`,
				);
				return;
			}
			respond(404, { detail: 'not found' });
		});
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			resolve({
				server,
				state,
				baseUrl: `http://127.0.0.1:${server.address().port}`,
			});
		});
	});
}
