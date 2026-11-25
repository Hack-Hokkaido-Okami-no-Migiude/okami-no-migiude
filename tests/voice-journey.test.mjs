// Voice journey: spawns the built Nitro server with loopback stubs for the
// ElevenLabs token endpoint and the Linkup research API (via the
// ELEVENLABS_API_BASE_URL / LINKUP_API_BASE_URL QA overrides) and exercises
// the voice chat surface end to end: the config gate, consented session
// start with profile intake, background research through the worker, the
// supersede rule, and both ElevenLabs webhooks. No HTTP test backdoors:
// lifecycle details are read from the synthetic SQLite data directly.
// Run: node --test tests/voice-journey.test.mjs   (needs `npm run build`)
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

const VOICE_ENV = {
	ELEVENLABS_API_KEY: 'ek_test_stubbed',
	ELEVENLABS_AGENT_ID: 'agent_stub',
	ELEVENLABS_WEBHOOK_SECRET: 'whsec_test',
	RESEARCH_TOOL_SECRET: 'tool_test_secret',
	LINKUP_API_KEY: 'linkup_test_key',
};

const OWNER_A = {
	email: 'voice-owner@example.test',
	password: 'voice-owner-pass-1234',
	profile: {
		name: '山田 花子',
		businessName: '湯の花旅館',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};

// Structured Linkup output: the second case deliberately carries two
// unusable source URLs (unparseable, credentialed) that must be filtered.
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
	{
		title: 'Ryokan weekday pricing pilot',
		company: 'Toya Lake Ryokan',
		problem: 'Flat pricing left green-season rooms empty',
		solution: 'Weekday discounts tied to the local event calendar',
		outcome: 'Green-season occupancy up 12 points',
		applicability: 'Adaptable without a property management system',
		cost_complexity: 'Spreadsheet-level cost, one week setup',
		source_urls: [
			'https://example.test/ryokan-pricing',
			'not a url',
			'https://user:pass@example.test/nope',
		],
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
	{
		title: 'Ryokan weekday pricing pilot',
		company: 'Toya Lake Ryokan',
		problem: 'Flat pricing left green-season rooms empty',
		solution: 'Weekday discounts tied to the local event calendar',
		outcome: 'Green-season occupancy up 12 points',
		applicability: 'Adaptable without a property management system',
		costComplexity: 'Spreadsheet-level cost, one week setup',
		sourceUrls: ['https://example.test/ryokan-pricing'],
	},
];

const dataDir = path.join(
	repoRoot,
	'.data',
	'test',
	`voice-journey-${process.pid}`,
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
	assert.equal(
		typeof response.json?.data?.message,
		'string',
		`${step}: data.message should be a human-readable string`,
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

function voiceRows(dir) {
	return withDb(dir, (db) =>
		db
			.prepare(
				`SELECT conversation_id, research_status, research_task_id,
				        transcript IS NOT NULL AS has_transcript, business
				 FROM voice_sessions ORDER BY created_at, conversation_id`,
			)
			.all(),
	);
}

function signWebhook(
	raw,
	timestampSeconds,
	secret = VOICE_ENV.ELEVENLABS_WEBHOOK_SECRET,
) {
	const digest = crypto
		.createHmac('sha256', secret)
		.update(`${timestampSeconds}.`)
		.update(raw)
		.digest('hex');
	return `t=${timestampSeconds},v0=${digest}`;
}

/**
 * Loopback stub for the two provider APIs. The first research call returns
 * a task that completes immediately, every later call a task that stays
 * pending forever — enough to drive the completion, supersede and failure
 * paths deterministically.
 */
function startProviderStub() {
	const state = { tokensIssued: 0, researchRequests: [] };
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			const respond = (status, payload) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(payload));
			};
			const url = new URL(req.url, 'http://stub');
			if (
				url.pathname === '/v1/convai/conversation/token'
				&& (req.method === 'GET' || req.method === 'POST')
			) {
				if (
					url.searchParams.get('agent_id')
					!== VOICE_ENV.ELEVENLABS_AGENT_ID
				) {
					respond(400, { detail: 'unknown agent_id' });
					return;
				}
				state.tokensIssued += 1;
				respond(200, {
					conversation_id: `conv_stub_${state.tokensIssued}`,
					token: `tok_${state.tokensIssued}`,
				});
				return;
			}
			if (url.pathname === '/v1/research' && req.method === 'POST') {
				state.researchRequests.push(
					Buffer.concat(chunks).toString('utf8'),
				);
				// Call #2 stays pending forever (drives the supersede path);
				// every other call completes immediately.
				const taskId =
					state.researchRequests.length === 2 ?
						'task_wait'
					:	'task_ok';
				respond(200, { id: taskId });
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
				} else if (taskId === 'task_wait') {
					respond(200, { status: 'pending' });
				} else {
					respond(500, { detail: 'unknown task' });
				}
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

/** Spawns the built server on a free loopback port with pinned test env. */
async function startVoiceServer({ label, dir, extraEnv = {} }) {
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
		SMTP_HOST: '',
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
	'voice is unavailable without credentials',
	{ timeout: 120000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const dir = path.join(dataDir, 'unconfigured');
		fs.mkdirSync(dir, { recursive: true });
		const server = await startVoiceServer({ label: 'voice-off', dir });
		try {
			const config = await request(
				server.baseUrl,
				'GET',
				'/api/voice/config',
				{
					origin: null,
				},
			);
			expectStatus('config (unconfigured)', config, 200);
			assert.deepEqual(config.json, { available: false });

			const anonymous = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ origin: null },
			);
			expectStatus('current without a session cookie', anonymous, 401);
			expectErrorCode(
				'current without a session cookie',
				anonymous,
				'unauthorized',
			);

			const jar = await signupOwner(server.baseUrl, OWNER_A.email);
			const start = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{
					body: { consent: true },
					jar,
				},
			);
			expectStatus('start voice session (unconfigured)', start, 503);
			expectErrorCode(
				'start voice session (unconfigured)',
				start,
				'voice_unavailable',
			);

			const research = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: {
						conversation_id: 'conv_any',
						business_name: 'x',
						location: 'y',
						business_type: 'z',
					},
					headers: { authorization: 'Bearer tool_test_secret' },
					origin: null,
				},
			);
			expectStatus('start-research (unconfigured)', research, 503);
			expectErrorCode(
				'start-research (unconfigured)',
				research,
				'voice_unavailable',
			);

			const raw = Buffer.from(
				JSON.stringify({ type: 'post_call_transcription', data: {} }),
				'utf8',
			);
			const postCall = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						raw,
						Math.floor(Date.now() / 1000),
					),
				},
				raw,
			);
			expectStatus('post-call (unconfigured)', postCall, 503);
			expectErrorCode(
				'post-call (unconfigured)',
				postCall,
				'voice_unavailable',
			);
		} finally {
			await server.close();
		}
	},
);

test(
	'voice journey: consent, profile intake, research, webhooks',
	{ timeout: 300000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
		const dir = path.join(dataDir, 'journey');
		fs.mkdirSync(dir, { recursive: true });
		const stub = await startProviderStub();
		const server = await startVoiceServer({
			label: 'voice-on',
			dir,
			extraEnv: {
				...VOICE_ENV,
				ELEVENLABS_API_BASE_URL: stub.baseUrl,
				LINKUP_API_BASE_URL: stub.baseUrl,
			},
		});
		try {
			console.log('## step: voice config reports available');
			const config = await request(
				server.baseUrl,
				'GET',
				'/api/voice/config',
				{ origin: null },
			);
			expectStatus('config (configured)', config, 200);
			assert.deepEqual(config.json, { available: true });

			const jar = newCookieJar();
			const staffJar = newCookieJar();
			await signupOwnerWith(server.baseUrl, jar);
			await loginStaff(server.baseUrl, staffJar);

			console.log('## step: consent validation');
			const missingConsent = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: {}, jar },
			);
			expectStatus('start without consent', missingConsent, 400);
			expectErrorCode(
				'start without consent',
				missingConsent,
				'validation',
			);

			const falseConsent = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: false }, jar },
			);
			expectStatus('start with consent false', falseConsent, 400);
			expectErrorCode(
				'start with consent false',
				falseConsent,
				'validation',
			);

			const staffStart = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: true }, jar: staffJar },
			);
			expectStatus('staff cannot start a voice chat', staffStart, 403);
			expectErrorCode(
				'staff cannot start a voice chat',
				staffStart,
				'forbidden',
			);

			console.log('## step: session 1 starts with profile intake');
			const emptyCurrent = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ jar },
			);
			expectStatus('current before any session', emptyCurrent, 200);
			assert.deepEqual(emptyCurrent.json, { session: null });

			const start1 = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: true }, jar },
			);
			expectStatus('start session 1', start1, 201);
			assert.deepEqual(start1.json, {
				conversationId: 'conv_stub_1',
				conversationToken: 'tok_1',
			});

			const current1 = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ jar },
			);
			expectStatus('current after session 1', current1, 200);
			assert.equal(current1.json.session.conversationId, 'conv_stub_1');
			assert.equal(current1.json.session.reportLanguage, 'ja');
			assert.equal(current1.json.session.transcriptRecorded, false);
			assert.equal(current1.json.session.transcript, null);
			assert.deepEqual(current1.json.session.research.business, {
				businessName: '湯の花旅館',
				location: 'ニセコ町',
				businessType: 'Accommodation',
			});

			console.log('## step: worker completes session 1 research');
			await pollUntil('session 1 research completed', async () => {
				const current = await request(
					server.baseUrl,
					'GET',
					'/api/voice/sessions/current',
					{ jar },
				);
				return (
					current.json.session?.research.status === 'completed'
					&& current.json.session.research.started === true
				);
			});
			const cases1 = (
				await request(
					server.baseUrl,
					'GET',
					'/api/voice/sessions/current',
					{
						jar,
					},
				)
			).json.session.research.cases;
			assert.deepEqual(cases1, EXPECTED_CASES);

			const researchBody = JSON.parse(stub.state.researchRequests[0]);
			assert.match(researchBody.q, /ニセコ町/);
			assert.match(researchBody.q, /Accommodation/);
			assert.doesNotMatch(researchBody.q, /\[(LOCATION|BUSINESS_TYPE)\]/);
			assert.equal(researchBody.mode, 'research');
			assert.equal(typeof researchBody.structuredOutputSchema, 'string');

			console.log('## step: session 2 research stays pending');
			const start2 = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: true }, jar },
			);
			expectStatus('start session 2', start2, 201);
			assert.equal(start2.json.conversationId, 'conv_stub_2');
			await pollUntil('session 2 research polling', async () => {
				const current = await request(
					server.baseUrl,
					'GET',
					'/api/voice/sessions/current',
					{ jar },
				);
				return (
					current.json.session?.research.status === 'polling'
					&& current.json.session.research.started === true
				);
			});

			console.log(
				'## step: session 3 supersedes the abandoned session 2',
			);
			const start3 = await request(
				server.baseUrl,
				'POST',
				'/api/voice/sessions',
				{ body: { consent: true }, jar },
			);
			expectStatus('start session 3', start3, 201);
			assert.equal(start3.json.conversationId, 'conv_stub_3');
			await pollUntil('session 3 research completed', async () => {
				const current = await request(
					server.baseUrl,
					'GET',
					'/api/voice/sessions/current',
					{ jar },
				);
				return (
					current.json.session?.research.status === 'completed'
					&& current.json.session.conversationId === 'conv_stub_3'
				);
			});
			const rows = voiceRows(dir);
			assert.deepEqual(
				rows.map((row) => [
					row.conversation_id,
					row.research_status,
					Boolean(row.has_transcript),
				]),
				[
					['conv_stub_1', 'completed', false],
					['conv_stub_2', 'failed', false],
					['conv_stub_3', 'completed', false],
				],
			);
			assert.deepEqual(
				JSON.parse(
					rows.find((row) => row.conversation_id === 'conv_stub_1')
						.business,
				),
				{
					businessName: '湯の花旅館',
					location: 'ニセコ町',
					businessType: 'Accommodation',
				},
			);

			console.log('## step: start-research webhook tool');
			const noAuth = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: webhookResearchBody('conv_stub_3'),
					origin: null,
				},
			);
			expectStatus('start-research without a token', noAuth, 401);
			expectErrorCode(
				'start-research without a token',
				noAuth,
				'unauthorized',
			);

			const wrongAuth = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: webhookResearchBody('conv_stub_3'),
					headers: { authorization: 'Bearer not-the-secret' },
					origin: null,
				},
			);
			expectStatus('start-research with a wrong token', wrongAuth, 401);

			const missingField = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: {
						conversation_id: 'conv_stub_3',
						business_name: 'x',
						location: 'y',
					},
					headers: {
						authorization: `Bearer ${VOICE_ENV.RESEARCH_TOOL_SECRET}`,
					},
					origin: null,
				},
			);
			expectStatus(
				'start-research missing business_type',
				missingField,
				400,
			);
			expectErrorCode(
				'start-research missing business_type',
				missingField,
				'validation',
			);

			const unknownConversation = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: webhookResearchBody('conv_unknown'),
					headers: {
						authorization: `Bearer ${VOICE_ENV.RESEARCH_TOOL_SECRET}`,
					},
					origin: null,
				},
			);
			expectStatus(
				'start-research unknown conversation',
				unknownConversation,
				404,
			);
			expectErrorCode(
				'start-research unknown conversation',
				unknownConversation,
				'not_found',
			);

			const replay = await request(
				server.baseUrl,
				'POST',
				'/api/voice/elevenlabs/start-research',
				{
					body: webhookResearchBody('conv_stub_3'),
					headers: {
						authorization: `Bearer ${VOICE_ENV.RESEARCH_TOOL_SECRET}`,
					},
					origin: null,
				},
			);
			expectStatus('start-research replay is idempotent', replay, 202);
			assert.deepEqual(replay.json, { status: 'completed' });

			console.log('## step: post-call transcription webhook');
			const transcriptTurns = [
				{
					role: 'agent',
					message: 'こんにちは。今日はよろしくお願いします。',
				},
				{ role: 'user', message: 'こんにちは。旅館のことを話します。' },
				{
					role: 'agent',
					message: 'まず、いま一番大変なことは何ですか。',
				},
			];
			const postCallBody = (conversationId, agentId) =>
				Buffer.from(
					JSON.stringify({
						type: 'post_call_transcription',
						data: {
							agent_id: agentId,
							conversation_id: conversationId,
							transcript: transcriptTurns,
						},
					}),
					'utf8',
				);
			const unsigned = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{ 'content-type': 'application/json' },
				postCallBody('conv_stub_3', VOICE_ENV.ELEVENLABS_AGENT_ID),
			);
			expectStatus('post-call without a signature', unsigned, 401);
			expectErrorCode(
				'post-call without a signature',
				unsigned,
				'unauthorized',
			);

			const badSecretRaw = postCallBody(
				'conv_stub_3',
				VOICE_ENV.ELEVENLABS_AGENT_ID,
			);
			const badSecret = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						badSecretRaw,
						Math.floor(Date.now() / 1000),
						'other-secret',
					),
				},
				badSecretRaw,
			);
			expectStatus('post-call with a wrong secret', badSecret, 401);

			const validRaw = postCallBody(
				'conv_stub_3',
				VOICE_ENV.ELEVENLABS_AGENT_ID,
			);
			const valid = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						validRaw,
						Math.floor(Date.now() / 1000),
					),
				},
				validRaw,
			);
			expectStatus('post-call signed', valid, 200);
			assert.deepEqual(valid.json, { received: true });

			const afterPostCall = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ jar },
			);
			expectStatus('current after post-call', afterPostCall, 200);
			assert.equal(afterPostCall.json.session.transcriptRecorded, true);
			const expectedTranscript = [
				'Shima Enaga: こんにちは。今日はよろしくお願いします。',
				'Owner: こんにちは。旅館のことを話します。',
				'Shima Enaga: まず、いま一番大変なことは何ですか。',
			].join('\n');
			assert.equal(
				afterPostCall.json.session.transcript,
				expectedTranscript,
			);

			const tamperedRaw = Buffer.from(
				JSON.stringify({
					type: 'post_call_transcription',
					data: {
						agent_id: VOICE_ENV.ELEVENLABS_AGENT_ID,
						conversation_id: 'conv_stub_3',
						transcript: [
							...transcriptTurns,
							{ role: 'user', message: '追加の発言' },
						],
					},
				}),
				'utf8',
			);
			const tampered = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						tamperedRaw,
						Math.floor(Date.now() / 1000),
					),
				},
				tamperedRaw,
			);
			expectStatus('post-call replay', tampered, 200);
			const afterReplay = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ jar },
			);
			assert.equal(
				afterReplay.json.session.transcript,
				expectedTranscript,
				'the first transcript wins on replay',
			);

			const otherAgentRaw = postCallBody('conv_stub_3', 'agent_other');
			const otherAgent = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						otherAgentRaw,
						Math.floor(Date.now() / 1000),
					),
				},
				otherAgentRaw,
			);
			expectStatus('post-call from another agent', otherAgent, 200);
			const afterOtherAgent = await request(
				server.baseUrl,
				'GET',
				'/api/voice/sessions/current',
				{ jar },
			);
			assert.equal(
				afterOtherAgent.json.session.transcript,
				expectedTranscript,
			);

			const unknownRaw = postCallBody(
				'conv_unknown',
				VOICE_ENV.ELEVENLABS_AGENT_ID,
			);
			const unknown = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						unknownRaw,
						Math.floor(Date.now() / 1000),
					),
				},
				unknownRaw,
			);
			expectStatus('post-call for an unknown conversation', unknown, 200);
			assert.deepEqual(unknown.json, { received: true });

			const otherTypeRaw = Buffer.from(
				JSON.stringify({ type: 'call_analyzed', data: {} }),
				'utf8',
			);
			const otherType = await requestRaw(
				server.baseUrl,
				'/api/voice/elevenlabs/post-call',
				{
					'content-type': 'application/json',
					'elevenlabs-signature': signWebhook(
						otherTypeRaw,
						Math.floor(Date.now() / 1000),
					),
				},
				otherTypeRaw,
			);
			expectStatus('post-call of another type', otherType, 200);
			assert.deepEqual(otherType.json, { received: true });
		} finally {
			await server.close();
			stub.server.close();
		}
	},
);

function webhookResearchBody(conversationId) {
	return {
		conversation_id: conversationId,
		business_name: '湯の花旅館',
		location: 'ニセコ町',
		business_type: 'Accommodation',
	};
}

async function signupOwnerWith(baseUrl, jar) {
	const response = await request(baseUrl, 'POST', '/api/auth/signup', {
		body: OWNER_A,
		jar,
	});
	expectStatus('signup owner', response, 201);
}

async function loginStaff(baseUrl, jar) {
	const response = await request(baseUrl, 'POST', '/api/auth/login', {
		body: {
			email: 'staff@example.test',
			password: 'staff-pass-1234',
		},
		jar,
	});
	expectStatus('staff login', response, 200);
}
