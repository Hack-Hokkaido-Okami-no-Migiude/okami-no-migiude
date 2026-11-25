// End-to-end shell checks for the Okami no Migiude entry shell.
//
// Run against a real built Nitro server on an isolated localhost port:
//   npm run build
//   node --test tests/shell-pages.test.mjs
//
// Set SHELL_APP_ROOT to a directory containing its own .output/ build when
// running against an isolated Nuxt build (shared .nuxt/.output are not safe
// to build concurrently with other workers). Defaults to the repo root.
// Demo credentials below are fictional fixtures, not secrets.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');
const appRoot =
	process.env.SHELL_APP_ROOT ?
		path.resolve(process.env.SHELL_APP_ROOT)
	:	repoRoot;
const serverEntry = path.join(appRoot, '.output', 'server', 'index.mjs');

const STAFF_EMAIL = 'shell-staff@example.test';
const STAFF_PASSWORD = 'test-staff-password-5678';

const OWNER = {
	email: `shell-owner-${process.pid}@example.test`,
	password: 'shell-owner-pass-1234',
	profile: {
		name: '北海 花子',
		businessName: 'パン屋こむぎ',
		businessType: 'food_service',
		municipality: '旭川市',
		phone: '0166-00-0000',
		website: 'https://example.test/komugi',
		note: '売れ筋商品の分析がほしい',
		locale: 'ja',
	},
};

const dataDir = path.join(
	repoRoot,
	'.data',
	'test',
	`shell-pages-${process.pid}`,
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

function newCookieJar() {
	const jar = { map: new Map() };
	jar.capture = (response) => {
		for (const line of response.headers.getSetCookie()) {
			const pair = line.split(';')[0];
			const eq = pair.indexOf('=');
			if (eq > 0) {
				const name = pair.slice(0, eq).trim();
				const value = pair.slice(eq + 1).trim();
				if (value === '') {
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
		// non-JSON body
	}
	return {
		status: response.status,
		headers: response.headers,
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

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
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

test(
	'shell pages: localized entry, account forms, session-aware chrome',
	{ timeout: 120000 },
	async () => {
		assert.equal(
			fs.existsSync(serverEntry),
			true,
			`${serverEntry} is missing — run \`npm run build\` first (or set SHELL_APP_ROOT to an isolated build)`,
		);

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
				WORKER_POLL_MS: '60000',
			},
			stdio: ['ignore', 'inherit', 'inherit'],
		});

		try {
			await pollUntil('server ready', async () => {
				const probe = await request(baseUrl, 'GET', '/', {
					origin: null,
				});
				return probe.status === 200;
			});

			// ------------------------------------------------------------------
			// Home page (signed out, ja default)
			// ------------------------------------------------------------------
			console.log('## step: home page shell content (ja, signed out)');
			const home = await request(baseUrl, 'GET', '/', { origin: null });
			expectStatus('home', home, 200);
			assert.match(home.text, /lang="ja"/);
			assert.match(home.text, /女将の右腕/);
			assert.match(
				home.text,
				/page-shell/,
				'public .page-shell primitive',
			);
			assert.match(home.text, /panel/, 'public .panel primitive');
			assert.match(home.text, /button-primary/, 'public .button-primary');
			assert.match(
				home.text,
				/button-secondary/,
				'public .button-secondary',
			);
			assert.match(home.text, /eyebrow/, 'public .eyebrow primitive');
			assert.match(
				home.text,
				/\/branding\/shima-enaga\.svg/,
				'mascot image',
			);
			assert.match(home.text, /href="\/signup"/, 'prominent signup link');
			assert.match(
				home.text,
				/href="\/sign-in"/,
				'prominent sign-in link',
			);
			assert.match(
				home.text,
				/\/sign-in\?next=\/interview/,
				'owner start routes through sign-in with a safe next',
			);
			assert.doesNotMatch(
				home.text,
				/href="\/interview"/,
				'no owner interview link while signed out',
			);
			assert.doesNotMatch(
				home.text,
				/ログアウト/,
				'no sign-out while signed out',
			);

			console.log('## step: locale cookie switches the whole shell');
			const homeEn = await request(baseUrl, 'GET', '/', {
				origin: null,
				headers: { cookie: 'app-locale=en' },
			});
			expectStatus('home en', homeEn, 200);
			assert.match(homeEn.text, /lang="en"/);
			assert.match(homeEn.text, /Okami no Migiude/);
			assert.doesNotMatch(
				homeEn.text,
				/女将の右腕/,
				'no Japanese strings in en shell',
			);

			// ------------------------------------------------------------------
			// Signup form
			// ------------------------------------------------------------------
			console.log('## step: signup form');
			const signup = await request(baseUrl, 'GET', '/signup', {
				origin: null,
			});
			expectStatus('signup', signup, 200);
			for (const businessType of [
				'accommodation',
				'food_service',
				'retail',
				'tourism',
				'agriculture',
				'manufacturing',
				'construction',
				'transport',
				'healthcare',
				'professional_services',
				'other',
			]) {
				assert.match(
					signup.text,
					new RegExp(`value="${businessType}"`),
					`business type option ${businessType}`,
				);
			}
			assert.match(
				signup.text,
				/name="otherBusinessType"/,
				'conditional field',
			);
			assert.match(signup.text, /宿泊業/, 'ja business labels render');
			assert.match(signup.text, /（任意）/, 'optional fields are marked');
			assert.match(
				signup.text,
				/minlength="8"/,
				'password minimum length',
			);
			assert.match(
				signup.text,
				/required/,
				'required attributes present',
			);

			// ------------------------------------------------------------------
			// Sign-in form and ?next= safety
			// ------------------------------------------------------------------
			console.log('## step: sign-in page and next sanitization');
			const reportId = '3f0f3f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
			const signIn = await request(
				baseUrl,
				'GET',
				`/sign-in?next=${encodeURIComponent(`/reports/${reportId}`)}`,
				{ origin: null },
			);
			expectStatus('sign-in', signIn, 200);
			assert.match(
				signIn.text,
				new RegExp(`value="/reports/${reportId}"`),
				'safe next is preserved for after sign-in',
			);
			for (const evil of [
				'https://evil.example/reports/x',
				'//evil.example/reports/x',
				'javascript:alert(1)',
			]) {
				const evilPage = await request(
					baseUrl,
					'GET',
					`/sign-in?next=${encodeURIComponent(evil)}`,
					{ origin: null },
				);
				expectStatus(`sign-in evil ${evil}`, evilPage, 200);
				// The unsanitized value may appear inside Nuxt's inert JSON payload,
				// but it must never be echoed into any rendered attribute.
				assert.doesNotMatch(
					evilPage.text,
					/(?:value|href)="[^"]*(?:evil\.example|javascript:)/,
					`unsafe next is dropped from attributes (${evil})`,
				);
			}

			// ------------------------------------------------------------------
			// Mascot + favicon assets
			// ------------------------------------------------------------------
			console.log('## step: branding assets');
			const mascot = await request(
				baseUrl,
				'GET',
				'/branding/shima-enaga.svg',
				{ origin: null },
			);
			expectStatus('mascot', mascot, 200);
			assert.match(
				mascot.headers.get('content-type') ?? '',
				/image\/svg\+xml/,
				'svg content type',
			);
			assert.match(mascot.text, /<svg/, 'real svg markup');
			assert.ok(mascot.text.length > 800, 'svg is not a stub');
			assert.match(mascot.text, /シマエナガ/, 'accessible title');
			const favicon = await request(
				baseUrl,
				'GET',
				'/branding/favicon.svg',
				{
					origin: null,
				},
			);
			expectStatus('favicon', favicon, 200);

			// ------------------------------------------------------------------
			// Built CSS: primitives present, no Bootstrap CDN
			// ------------------------------------------------------------------
			console.log('## step: built css primitives without CDN');
			const cssHref = home.text.match(
				/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/,
			)?.[1];
			assert.ok(cssHref, 'stylesheet link found');
			const css = await request(baseUrl, 'GET', cssHref, {
				origin: null,
			});
			expectStatus('css', css, 200);
			for (const primitive of [
				'.page-shell',
				'.panel',
				'.button-primary',
				'.button-secondary',
				'.eyebrow',
				'.notice',
				'.form-field',
			]) {
				assert.ok(
					css.text.includes(primitive),
					`built css defines ${primitive}`,
				);
			}
			assert.doesNotMatch(
				css.text,
				/jsdelivr|bootstrap/i,
				'no bootstrap/jsdelivr in served css',
			);

			// ------------------------------------------------------------------
			// Session-aware chrome: owner
			// ------------------------------------------------------------------
			console.log('## step: owner session changes the chrome');
			const ownerJar = newCookieJar();
			const signupResponse = await request(
				baseUrl,
				'POST',
				'/api/auth/signup',
				{ body: OWNER, jar: ownerJar },
			);
			expectStatus('owner signup', signupResponse, 201);
			const homeOwner = await request(baseUrl, 'GET', '/', {
				origin: null,
				jar: ownerJar,
			});
			expectStatus('home owner', homeOwner, 200);
			assert.match(
				homeOwner.text,
				/北海 花子/,
				'owner name in the chrome',
			);
			assert.match(
				homeOwner.text,
				/href="\/interview"/,
				'owner interview link appears',
			);
			assert.match(
				homeOwner.text,
				/ログアウト/,
				'sign-out control appears',
			);
			assert.doesNotMatch(
				homeOwner.text,
				/href="\/sign-in"/,
				'sign-in link disappears when signed in',
			);

			// ------------------------------------------------------------------
			// Session-aware chrome: staff
			// ------------------------------------------------------------------
			console.log('## step: staff session changes the chrome');
			const staffJar = newCookieJar();
			const staffLogin = await request(
				baseUrl,
				'POST',
				'/api/auth/login',
				{
					body: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
					jar: staffJar,
				},
			);
			expectStatus('staff login', staffLogin, 200);
			const homeStaff = await request(baseUrl, 'GET', '/', {
				origin: null,
				jar: staffJar,
			});
			expectStatus('home staff', homeStaff, 200);
			assert.match(
				homeStaff.text,
				/href="\/staff"/,
				'staff queue link appears',
			);
			assert.doesNotMatch(
				homeStaff.text,
				/href="\/interview"/,
				'staff never sees the owner interview link',
			);

			// ------------------------------------------------------------------
			// Sign-out returns the chrome to the signed-out state
			// ------------------------------------------------------------------
			console.log('## step: sign-out');
			const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
				jar: ownerJar,
			});
			expectStatus('logout', logout, 200);
			const homeAfter = await request(baseUrl, 'GET', '/', {
				origin: null,
				jar: ownerJar,
			});
			expectStatus('home after logout', homeAfter, 200);
			assert.match(
				homeAfter.text,
				/href="\/sign-in"/,
				'sign-in link back',
			);
			assert.doesNotMatch(
				homeAfter.text,
				/href="\/interview"/,
				'owner link gone after sign-out',
			);
		} finally {
			// Windows note: child.kill() can leave the process reaping slowly;
			// escalate to taskkill so cleanup never masks the real test result.
			child.kill('SIGKILL');
			await pollUntil(
				'server exit',
				async () => child.exitCode !== null,
				5000,
				200,
			).catch(() => {});
			if (child.exitCode === null && process.platform === 'win32') {
				spawn('taskkill', ['/PID', String(child.pid), '/F', '/T'], {
					stdio: 'ignore',
				});
			}
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	},
);
