import { after, before, test } from 'node:test';
import { build, copyPublicAssets, createNitro, prepare } from 'nitropack';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import assert from 'node:assert/strict';
import { request as clearRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { request as secureRequest } from 'node:https';

// Standalone same-version Nitro build with a deliberately leaking canary renderer
// and public payload. Set SHIMA_TEST_BUILT=1 to do the same wire checks against
// the full built app after its build. OpenSSL generates a disposable localhost
// cert; each HTTPS client trusts only that test cert (no global TLS override).
// All scratch work (cert, key, fixture store) stays under the repo-local .data
// directory that the boundary test owns; nothing is written to the system temp.
const root = fileURLToPath(new URL('../../', import.meta.url));
const fullBuild = process.env.SHIMA_TEST_BUILT === '1';
const token = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(token).digest('hex');
const actorId = 'synthetic-private-actor';
const businessId = 'cli_synthetic_private';
const session = `/api/clients/${businessId}/sessions/ses_synthetic_private`;
const pkg = `${session}/shima/packages/pkg_synthetic`;
const login = '/api/pilot-auth/session';
const canary = 'DO_NOT_SERIALIZE_PRIVATE_CANARY';
/** Exact fictional demo audio the boundary admits in fixture-local only. */
const fixtureDemoAudioPaths = [
	'/demo/shima/shima-demo-intro-owner.wav',
	'/demo/shima/shima-demo-question-shima.wav',
	'/demo/shima/shima-demo-answer-owner.wav',
];
const host = 'localhost';
const origin = `https://${host}`;
const config = {
	SHIMA_MODE: 'private-capture',
	SHIMA_PILOT_ORIGIN: origin,
	SHIMA_PILOT_BUSINESS_ID: businessId,
	SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
		{ actorId, businessId, role: 'owner', tokenSha256: digest },
	]),
};
let directory: string;
let entry: string;
let cert: string;
let key: string;

before(async () => {
	await mkdir(join(root, '.data'), { recursive: true });
	directory = await mkdtemp(join(root, '.data', 'boundary-'));
	const keyPath = join(directory, 'key.pem');
	const certPath = join(directory, 'cert.pem');
	execFileSync('openssl', [
		'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
		'-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
		'-keyout', keyPath, '-out', certPath,
	], { stdio: 'ignore', timeout: 10_000, env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } });
	[cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
	if (fullBuild) {
		entry = join(root, '.output/server/index.mjs');
		return;
	}
	const publicDir = join(directory, 'public');
	const fallback = join(directory, 'fallback.mjs');
	const demoDir = join(publicDir, 'demo', 'shima');
	await mkdir(join(publicDir, '_nuxt'), { recursive: true });
	await mkdir(demoDir, { recursive: true });
	await Promise.all([
		writeFile(join(publicDir, '_payload.json'), JSON.stringify({ canary })),
		writeFile(join(publicDir, '_nuxt', 'test.js'), '// Known asset'),
		...fixtureDemoAudioPaths.map(
			(path) => writeFile(join(demoDir, path.split('/').pop()!), 'RIFFfiction'),
		),
		writeFile(fallback, `export default () => ({ canary: ${JSON.stringify(canary)} });`),
	]);
	const nitro = await createNitro({
		rootDir: directory,
		scanDirs: [],
		preset: 'node-server',
		compatibilityDate: '2025-11-24',
		logLevel: 0,
		nodeModulesDirs: [join(root, 'node_modules')],
		plugins: [join(root, 'server/pilot/runtime.ts').replaceAll('\\', '/')],
		publicAssets: [{ dir: publicDir }],
		handlers: [
			{ middleware: true, handler: join(root, 'server/middleware/shima-boundary.ts').replaceAll('\\', '/') },
			{ route: login, method: 'post', handler: join(root, 'server/api/pilot-auth/session.post.ts').replaceAll('\\', '/') },
			{ route: '/**', handler: fallback.replaceAll('\\', '/') },
		],
	});
	try {
		await prepare(nitro);
		await copyPublicAssets(nitro);
		await build(nitro);
		entry = join(nitro.options.output.serverDir, 'index.mjs');
	} finally {
		await nitro.close();
	}
});

after(async () => {
	if (directory) {await rm(directory, { recursive: true, force: true });}
});

async function server(
	env: Record<string, string | undefined>,
	tls: boolean,
	address = '127.0.0.1',
) {
	const child = spawn(process.execPath, [entry], {
		cwd: directory,
		// Do not inherit the operator's app configuration or provider credentials.
		env: {
			SystemRoot: process.env.SystemRoot,
			NODE_ENV: 'production',
			DEBUG: 'false',
			NITRO_HOST: address,
			NITRO_PORT: '0',
			NITRO_SSL_CERT: tls ? cert : undefined,
			NITRO_SSL_KEY: tls ? key : undefined,
			NUXT_DATA_DIR: join(directory, 'unused-store'),
			...env,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let logs = '';
	child.stdout.setEncoding('utf8').on('data', (chunk: string) => { logs += chunk; });
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => { logs += chunk; });
	const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
	const stop = async () => {
		child.kill();
		await stopped;
	};
	try {
		const port = await new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Test server did not start.')), 10_000);
			function listen(chunk: string) {
				const match = /Listening on https?:\/\/[^\s]+:(\d+)/.exec(chunk);
				if (match) {
					clearTimeout(timer);
					child.stdout.off('data', listen);
					resolve(Number(match[1]));
				}
			}
			child.stdout.on('data', listen);
			void stopped.then(() => {
				clearTimeout(timer);
				reject(new Error('Test server exited before listening.'));
			});
		});
		return { port, tls, address, stop, logs: () => logs };
	} catch (error) {
		await stop();
		throw error;
	}
}

type Running = Awaited<ReturnType<typeof server>>;
function call(
	{ port, tls, address }: Running,
	method: string,
	path: string,
	headers: Record<string, string> | string[] = { Host: host },
	body?: string,
	keepBodyOpen = false,
) {
	return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
		const req = (tls ? secureRequest : clearRequest)({
			hostname: address ?? '127.0.0.1', port, method, path, headers, agent: false,
			...(tls && { ca: cert, servername: host }),
		}, (res) => {
			res.setEncoding('utf8');
			let data = '';
			res.on('data', (chunk: string) => { data += chunk; });
			res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
			res.on('error', reject);
		});
		req.once('upgrade', (_, socket) => {
			socket.destroy();
			reject(new Error('Unexpected WebSocket upgrade.'));
		});
		req.once('error', reject);
		req.setTimeout(7_000, () => req.destroy(new Error('HTTP boundary test timed out.')));
		if (keepBodyOpen) {req.flushHeaders();}
		else {req.end(body);}
	});
}

function denied(response: Awaited<ReturnType<typeof call>>) {
	assert.equal(response.status, 404);
	assert.deepEqual(JSON.parse(response.body), { error: { code: 'not_found', message: 'Not found.' } });
	assert.equal(response.headers['cache-control'], 'no-store');
	assert.equal(response.headers['set-cookie'], undefined);
}

test('private root bypasses SSR and direct static/private payload requests are denied', async (t) => {
	const pilot = await server(config, true);
	t.after(pilot.stop);
	const home = await call(pilot, 'GET', '/');
	assert.equal(home.status, 200);
	assert.equal(home.headers['cache-control'], 'no-store');
	assert.match(home.body, /サインイン/);
	assert.doesNotMatch(home.body, /DO_NOT_SERIALIZE|__NUXT|_payload|架空・マイクなし|synthetic-private|<script/i);
	for (const target of ['/workbench', '/_payload.json', '/workbench/_payload.json', '/_nuxt/test.js', '/api/clients', '/quests', session]) {
		denied(await call(pilot, 'GET', target));
	}
});

function loginHeaders(body: string, overrides: Record<string, string> = {}) {
	return { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...overrides };
}

test('exact HTTPS login exchanges a token for a rotated opaque cookie', async (t) => {
	const pilot = await server(config, true);
	t.after(pilot.stop);
	const body = JSON.stringify({ token });
	const issued = await call(pilot, 'POST', login, loginHeaders(body), body);
	assert.equal(issued.status, 204);
	assert.equal(issued.body, '');
	assert.equal(issued.headers['cache-control'], 'no-store');
	const [setCookie] = issued.headers['set-cookie'] ?? [];
	assert.match(setCookie ?? '', /^__Host-shima-pilot=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/);
	assert.ok(!setCookie?.includes(token));
	const cookie = setCookie!.split(';')[0]!;
	const signed = { Host: host, Cookie: cookie };
	const home = await call(pilot, 'GET', '/', signed);
	assert.equal(home.status, 200);
	assert.match(home.body, /サインイン済み/);
	assert.equal(home.headers['cache-control'], 'no-store');
	const alias = await call(pilot, 'GET', '/shima', signed);
	assert.equal(alias.status, 303);
	assert.equal(alias.headers.location, '/');
	for (const supplied of [
		{ Host: host, Authorization: `Bearer ${token}`, 'X-Actor-Id': actorId },
		{ Host: host, Cookie: `__Host-shima-pilot=${token}; shima_demo_claimant=test` },
		{ Host: host, Cookie: `${cookie}; ${cookie}` },
	]) {
		assert.doesNotMatch((await call(pilot, 'GET', '/', supplied)).body, /サインイン済み/);
	}
	const unknown = JSON.stringify({ token: randomBytes(32).toString('base64url') });
	denied(await call(pilot, 'POST', login, loginHeaders(unknown), unknown));
	const form = `token=${token}`;
	const browser = await call(pilot, 'POST', login, loginHeaders(form, { 'Content-Type': 'application/x-www-form-urlencoded' }), form);
	assert.equal(browser.status, 303);
	assert.equal(browser.headers.location, '/');
	assert.equal(browser.headers['cache-control'], 'no-store');
	assert.notEqual(browser.headers['set-cookie']?.[0], setCookie);
	assert.doesNotMatch((await call(pilot, 'GET', '/', signed)).body, /サインイン済み/);
	for (const marker of [token, digest, actorId, businessId, canary]) {
		assert.ok(!home.body.includes(marker));
		assert.ok(!pilot.logs().includes(marker));
	}
});

test('incompatible TLS, host, origin, raw paths and methods deny before body reads', async (t) => {
	const [pilot, clear] = await Promise.all([server(config, true), server(config, false)]);
	t.after(pilot.stop);
	t.after(clear.stop);
	const open = { Host: host, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '512' };
	denied(await call(clear, 'GET', '/'));
	denied(await call(clear, 'POST', login, { ...open, 'X-Forwarded-Proto': 'https' }, undefined, true));
	const cases: [string, string, Record<string, string> | string[]][] = [
		['POST', login, { ...open, Host: 'LOCALHOST' }],
		['POST', login, { ...open, Host: 'localhost:443' }],
		['POST', login, { Host: host, 'Content-Length': '512' }],
		['POST', login, { ...open, Origin: 'null' }],
		['POST', login, { ...open, Origin: `${origin}/` }],
		['POST', login, { ...open, Forwarded: 'proto=https' }],
		['POST', login, ['Host', host, 'host', host, 'Origin', origin, 'Content-Length', '512']],
		['POST', login, ['Host', host, 'Origin', origin, 'origin', origin, 'Content-Length', '512']],
		['POST', `${login}?token=private-canary`, open],
		['POST', `${login}/`, open],
		['POST', login.replace('session', '%73ession'), open],
		['POST', `${origin}${login}`, open],
		['POST', '/api/pilot-auth/../pilot-auth/session', open],
		['POST', '//api/pilot-auth/session', open],
		['GET', login, { Host: host }],
		['OPTIONS', login, { Host: host }],
	];
	for (const [method, path, headers] of cases) {
		const response = await call(pilot, method, path, headers, undefined, method === 'POST');
		denied(response);
		assert.doesNotMatch(response.body, /private-canary/);
	}
	assert.ok(!pilot.logs().includes('private-canary'));
});

test('nitro dev front-server hop keeps fixture loopback open and everything else closed', async (t) => {
	// Nitro's dev front server stamps x-forwarded-for/port/proto on the hop to
	// the dev worker (NITRO_DEV_WORKER_ID). The boundary must ignore those
	// fields there without trusting them: transport stays the plain-HTTP hop.
	const stamped: Record<string, string> = {
		Host: host,
		'X-Forwarded-For': '203.0.113.10',
		'X-Forwarded-Proto': 'https',
		'X-Real-IP': '203.0.113.10',
	};
	const dev = await server({ NITRO_DEV_WORKER_ID: '1' }, false);
	t.after(dev.stop);
	const home = await call(dev, 'GET', '/', stamped);
	assert.equal(home.status, 200);
	const asset = fullBuild ? /\b(?:src|href)="(\/_nuxt\/[^"?]+\.(?:js|css))"/.exec(home.body)?.[1] : '/_nuxt/test.js';
	assert.ok(asset);
	assert.equal((await call(dev, 'GET', asset, stamped)).status, 200);
	for (const wav of fixtureDemoAudioPaths) {
		assert.equal((await call(dev, 'GET', wav, stamped)).status, 200);
	}
	denied(await call(dev, 'GET', '/demo/shima/shima-demo-other.wav', stamped));
	denied(await call(dev, 'GET', '/_payload.json', stamped));
	denied(await call(dev, 'POST', login, stamped, undefined, true));
	// Without the dev worker marker the strict rejection still applies.
	const strict = await server({}, false);
	t.after(strict.stop);
	denied(await call(strict, 'GET', '/', stamped));
	// The dev hop never satisfies private TLS-to-Node or forged transports.
	const privateDev = await server({ ...config, NITRO_DEV_WORKER_ID: '1' }, false);
	t.after(privateDev.stop);
	denied(await call(privateDev, 'GET', '/', stamped));
	denied(await call(privateDev, 'GET', fixtureDemoAudioPaths[0]!, stamped));
	const body = JSON.stringify({ token });
	denied(await call(privateDev, 'POST', login, {
		...stamped,
		'Content-Type': 'application/json',
		'Content-Length': String(Buffer.byteLength(body)),
	}, body));
	// A real non-loopback source socket stays denied with no canary bytes,
	// even in the dev worker and even with forwarding fields supplied.
	const remote = Object.values(networkInterfaces()).flat().find(
		(entry) => entry && !entry.internal && entry.family === 'IPv4',
	)?.address;
	if (!remote) { t.skip('no non-loopback IPv4 interface'); return; }
	const outside = await server({ NITRO_DEV_WORKER_ID: '1' }, false, remote);
	t.after(outside.stop);
	const far = await call(outside, 'GET', '/', { Host: host }).catch((error: Error) => {
		t.skip(`remote bind unreachable: ${error.message}`);
		return undefined;
	});
	if (far) {
		denied(far);
		assert.ok(!far.body.includes(canary));
	}
});

test('login enforces framing, syntax and the byte cap before issuing a cookie', async (t) => {
	const pilot = await server(config, true);
	t.after(pilot.stop);
	const json = JSON.stringify({ token });
	const checks: [string, Record<string, string>, number][] = [
		[json, { 'Content-Type': 'text/plain' }, 400],
		[json, { 'Content-Encoding': 'gzip' }, 400],
		[`{"token":"${token}","token":"${token}"}`, {}, 400],
		[JSON.stringify({ token, role: 'owner' }), {}, 400],
		[json.padEnd(513), {}, 413],
	];
	for (const [body, overrides, status] of checks) {
		const response = await call(pilot, 'POST', login, loginHeaders(body, overrides), body);
		assert.equal(response.status, status);
		assert.equal(response.headers['cache-control'], 'no-store');
		assert.equal(response.headers['set-cookie'], undefined);
		assert.doesNotMatch(response.body, /owner|token/);
	}
	const chunked = await call(pilot, 'POST', login, {
		Host: host, Origin: origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked',
	}, json);
	assert.equal(chunked.status, 400);
	assert.equal((await call(pilot, 'POST', login, loginHeaders(json.padEnd(512)), json.padEnd(512))).status, 204);
});

test('incomplete login reads time out and the process limits attempts', async (t) => {
	const pilot = await server(config, true);
	t.after(pilot.stop);
	const json = JSON.stringify({ token });
	const headers = loginHeaders(json);
	const incomplete = await call(pilot, 'POST', login, headers, undefined, true);
	assert.equal(incomplete.status, 400);
	assert.equal(incomplete.headers['set-cookie'], undefined);
	for (let index = 0; index < 29; index++) {
		assert.equal((await call(pilot, 'POST', login, headers, json)).status, 204);
	}
	const limited = await call(pilot, 'POST', login, headers, json);
	assert.equal(limited.status, 429);
	assert.equal(limited.headers['retry-after'], '60');
	assert.equal(limited.headers['set-cookie'], undefined);
});

test('signed-in private access has no fixture, legacy read, capture, provider or release routes', async (t) => {
	const pilot = await server(config, true);
	t.after(pilot.stop);
	const body = JSON.stringify({ token });
	const { headers } = await call(pilot, 'POST', login, loginHeaders(body), body);
	const cookie = headers['set-cookie']?.[0]?.split(';')[0];
	assert.ok(cookie);
	const signed = { Host: host, Origin: origin, Cookie: cookie };
	const blocked: [string, string][] = [
		['GET', '/workbench'], ['GET', '/quests'], ['GET', '/api/quests'], ['POST', '/api/demo/hotel'],
	['GET', '/demo/shima/shima-demo-intro-owner.wav'],
		['GET', session], ['GET', session.replace(businessId, 'cli_other_business')],
		['GET', `${session}/shima/map`], ['GET', `${session}/shima/packages`],
		['GET', `${session}/opportunities/opp_synthetic/plan.md`],
		['POST', '/api/clients'], ['POST', session.split('/').slice(0, -1).join('/')],
		['PUT', `${session}/transcript`], ['DELETE', `${session}/transcript?baseRev=1`],
		['POST', `${session}/analyze`], ['POST', `${session}/transcribe`],
		['PUT', `${session}/questions/q_synthetic/answer`],
		['PATCH', `${session}/steps/step_synthetic`],
		['POST', `${session}/opportunities/opp_synthetic/proposal`],
		['PATCH', `${session}/opportunities/opp_synthetic/plan`],
		['POST', `${session}/shima/participants`],
		['POST', `${session}/shima/interview/start`], ['POST', `${session}/shima/interview/stop`],
		['GET', `${session}/shima/interview/stream`], ['POST', `${session}/shima/interview/turns`],
		['PUT', `${session}/shima/effort/step_synthetic`],
		['POST', `${session}/shima/packages`], ['PATCH', pkg],
		['POST', `${pkg}/decision`], ['POST', `${pkg}/complete`],
		['POST', `${pkg}/preview`], ['POST', `${pkg}/publish`],
		...['preview', 'review', 'approve', 'permit', 'publish', 'withdraw'].map((action): [string, string] => ['POST', `${pkg}/pilot/${action}`]),
	];
	for (const [method, target] of blocked) {
		const writing = method === 'POST' || method === 'PUT' || method === 'PATCH';
		denied(await call(pilot, method, target, writing ? { ...signed, 'Content-Length': '512' } : signed, undefined, writing));
	}
	const upgrade = await call(pilot, 'GET', `${session}/shima/interview/stream`, {
		...signed, Upgrade: 'websocket', Connection: 'Upgrade',
		'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
	});
	denied(upgrade);
});

test('default loopback still dispatches fixture pages, build assets and capture inputs', async (t) => {
	const fixture = await server({}, false);
	t.after(fixture.stop);
	const home = await call(fixture, 'GET', '/');
	assert.equal(home.status, 200);
	const asset = fullBuild ? /\b(?:src|href)="(\/_nuxt\/[^"?]+\.(?:js|css))"/.exec(home.body)?.[1] : '/_nuxt/test.js';
	assert.ok(asset);
	assert.equal((await call(fixture, 'GET', asset)).status, 200);
	for (const wav of fixtureDemoAudioPaths) {
		assert.equal((await call(fixture, 'GET', wav)).status, 200);
	}
	denied(await call(fixture, 'GET', '/demo/shima/CREDITS.md'));
	denied(await call(fixture, 'GET', '/demo/shima/shima-demo-other.wav'));
	assert.equal((await call(fixture, 'GET', '/workbench')).status, 200);
	assert.equal((await call(fixture, 'POST', '/api/demo/hotel')).status, 200);
	if (!fullBuild) {
		for (const [method, path] of [
			['PUT', `${session}/transcript`], ['PUT', `${session}/questions/q_synthetic/answer`],
			['POST', `${pkg}/decision`], ['POST', `${pkg}/complete`],
		] as const) {
			assert.equal((await call(fixture, method, path)).status, 200);
		}
	}
	denied(await call(fixture, 'GET', '/', { Host: 'example.invalid' }));
	denied(await call(fixture, 'GET', '/_payload.json'));
	denied(await call(fixture, 'POST', login));
});

test('malformed private config, public-demo and even enabled real-pilot fail closed', async () => {
	for (const env of [
		{ SHIMA_MODE: '' }, { SHIMA_MODE: 'public-demo' },
		{ ...config, SHIMA_PILOT_PRINCIPALS_JSON: '{' },
		{ ...config, SHIMA_MODE: 'real-pilot', SHIMA_REAL_PILOT_ENABLED: 'true' },
	]) {
		const closed = await server(env, true);
		try {
			denied(await call(closed, 'GET', '/'));
			denied(await call(closed, 'POST', login));
			denied(await call(closed, 'GET', '/_payload.json'));
		} finally {
			await closed.stop();
		}
	}
});
