// Real-browser acceptance harness for the Okami no Migiude merged app.
//
// Drives an actual Chromium-class browser (Edge or Chrome, auto-detected)
// over the DevTools Protocol using Node 26's built-in WebSocket — no
// playwright dependency added (none is installed; package.json untouched).
//
// Run modes (from the repo root):
//   node tests/browser-journey.mjs            # full contract journey
//   node tests/browser-journey.mjs --smoke    # baseline homepage only
//   node tests/browser-journey.mjs --headed   # visible window (manual drive)
//   node tests/browser-journey.mjs --keep     # keep profile + data after run
//   node tests/browser-journey.mjs --clean    # purge old tests/.data first
//   BASE_URL=http://localhost:3000 node tests/browser-journey.mjs
//                                             # drive an already-running server
//
// The default full mode spawns its own built Nitro server (requires
// `npm run build` first) on a free loopback port with a synthetic DATA_DIR
// under tests/.data/test/<pid> — it never touches the demo .data, the shared
// .output (read-only) or .env (never read here; all env is passed explicitly).
// Synthetic users only (example.test addresses, invented businesses).
//
// Result statuses:
//   [PASS]    check ran and held.
//   [PENDING] the check needs UI that is still in flight (route 404, form
//             not found, or BASE_URL mode cannot reach the mail outbox).
//             PENDING never fails the run (unless --strict).
//   [FAIL]    an implemented surface misbehaved — fix before the demo.
//
// Exit code: 0 when no FAIL (PENDINGs are listed for the lead), 1 otherwise.
//
// ---------------------------------------------------------------------------
// MANUAL UI CHECKLIST for the lead (drive locally with --headed + --keep, or
// by hand against npm run dev):
//   1. /           — language switch ja⇄en actually flips visible strings.
//   2. /signup     — all §4 fields present incl. businessType dropdown with
//                    all 11 contract values; otherBusinessType appears only
//                    for "other"; locale choice persists into the session.
//   3. /interview  — no consent ⇒ start must be impossible (disabled/hidden/
//                    blocked, and NO POST /api/interviews/start in devtools
//                    network tab). With consent, mode=demo only (live never
//                    offered while INTEGRATION_* is unset).
//   4. Interview   — 「サンプル面談（フィクション）」/ "Sample interview
//                    (fictional)" label visible for the whole session; the
//                    scripted Q&A advances; submit lands on the new report.
//   5. /reports/:id — 「自動下書き（ルールベース）」/ "Automated draft
//                    (rule-based)" visible; download gives report-<id>.md;
//                    consultation shows a timestamp and a repeat click does
//                    not error.
//   6. Mail        — .eml in DATA_DIR/mail-outbox/<mailId>.eml; copy its
//                    /reports/:id link into a private window signed out ⇒
//                    /sign-in?next=/reports/:id ⇒ after sign-in the report.
//   7. /staff      — staff queue lists ALL owners newest first with the
//                    consultation flag; staff cannot start an interview or
//                    consult (403 paths); owner hitting /staff is walled.
//   8. Persistence — reload as owner and as staff: both stay signed in;
//                    the two roles never share state.
// ---------------------------------------------------------------------------
// Checks marked `needs final UI calibration` use generous label/DOM
// heuristics (accessible name, <label>, placeholder, name/id tokens, visible
// text, ja+en patterns) so they likely run unchanged, but exact selectors
// should be tightened once the real UIs land.

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');
const serverEntry = path.join(repoRoot, '.output', 'server', 'index.mjs');

// ---------------------------------------------------------------------------
// CLI + constants
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const OPTIONS = {
	smoke: argv.includes('--smoke'),
	headed: argv.includes('--headed'),
	keep: argv.includes('--keep'),
	clean: argv.includes('--clean'),
	strict: argv.includes('--strict'),
	help: argv.includes('--help') || argv.includes('-h'),
	baseUrl:
		argv
			.find((a) => a.startsWith('--base-url='))
			?.slice('--base-url='.length)
		?? process.env.BASE_URL
		?? null,
};

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const DATA_ROOT = path.join(testsDir, '.data');
const RUN_ROOT = path.join(DATA_ROOT, `run-${RUN_ID}`);
const PROFILE_DIR = path.join(RUN_ROOT, 'browser-profile');
const DOWNLOADS_DIR = path.join(RUN_ROOT, 'downloads');
const ARTIFACTS_DIR = path.join(RUN_ROOT, 'artifacts');
const SERVER_DATA_DIR = path.join(RUN_ROOT, 'server-data');

// Synthetic fixtures only — fictional, no real business or personal data.
const OWNER_UI = {
	email: `browser-owner-${crypto.randomUUID().slice(0, 8)}@example.test`,
	password: 'browser-owner-pass-0001',
	profile: {
		name: 'UIテスト オーナー',
		businessName: 'ブラウザテスト宿',
		businessType: 'accommodation',
		municipality: '札幌市',
		locale: 'ja',
	},
};
const OWNER_A = {
	email: `seed-a-${crypto.randomUUID().slice(0, 8)}@example.test`,
	password: 'seed-a-pass-0001',
	profile: {
		name: '種別 花子',
		businessName: 'シード宿 雪灯り',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};
const OWNER_B = {
	email: `seed-b-${crypto.randomUUID().slice(0, 8)}@example.test`,
	password: 'seed-b-pass-0001',
	profile: {
		name: 'Seed Taro',
		businessName: 'Seed Snow Tours',
		businessType: 'other',
		otherBusinessType: 'Backcountry snowshoe guides (fiction)',
		municipality: 'Kutchan Town',
		locale: 'en',
	},
};
const STAFF = {
	email: 'browser-staff@example.test',
	password: 'browser-staff-pass-0001',
};

// Fictional scripted dialogue (contract §11 substitute; keyword-rich so the
// rule-based draft is deterministic: 人手/採用, 繁忙, 予約).
const TRANSCRIPT_A = [
	'面接者: 本日はよろしくお願いします。まず事業の現状を教えてください。',
	'経営者: 雪灯りはニセコ町の小さな旅館で、客室は10室、冬はスキー客で繁忙期になります。',
	'面接者: 課題は何ですか。',
	'経営者: 人手不足です。清掃と朝食のスタッフが採用できず、繁忙期は家族総出です。',
	'面接者: 予約の状況は。',
	'経営者: リピーターと電話予約が中心で、Web予約がありません。冬は満室に近いですが、夏は閑散期です。',
	'面接者: 目標は。',
	'経営者: 通年稼働と後継ぎ体制づくりです。',
].join('\n');
const TRANSCRIPT_B = [
	'Interviewer: Please describe your business.',
	'Owner: We run fictional guided snowshoe tours around Kutchan. Winter peaks, green season is quiet.',
	'Interviewer: Main challenge?',
	'Owner: Hiring guides is hard and our website cannot take reservations yet.',
].join('\n');

const results = [];
function record(id, status, detail = '') {
	results.push({
		id,
		status,
		detail: String(detail).slice(0, 600),
		at: new Date().toISOString(),
	});
	const tag = { PASS: '[PASS]  ', PENDING: '[PENDING]', FAIL: '[FAIL]  ' }[
		status
	];
	console.log(`${tag} ${id}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => {
				resolve(port);
			});
		});
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
				`timeout after ${timeoutMs}ms: ${label}${lastError ? ` (last: ${lastError.message})` : ''}`,
			);
		}
		await sleep(intervalMs);
	}
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

async function api(baseUrl, method, pathname, options = {}) {
	const headers = { ...(options.headers ?? {}) };
	if (options.jar?.map.size > 0) {
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
	const response = await fetch(`${baseUrl}${pathname}`, {
		method,
		headers,
		body,
		redirect: 'manual',
	});
	options.jar?.capture(response);
	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Non-JSON (markdown download) stays null.
	}
	return {
		status: response.status,
		headers: response.headers,
		text,
		json,
		setCookies: response.headers.getSetCookie(),
	};
}

// ---------------------------------------------------------------------------
// Hermetic Nitro server (mirrors tests/api-journey.test.mjs conventions)
// ---------------------------------------------------------------------------

function startServer() {
	const running = [];
	async function start(label, pollMs) {
		const port = await freePort();
		const baseUrl = `http://127.0.0.1:${port}`;
		const child = spawn(process.execPath, [serverEntry], {
			cwd: repoRoot,
			env: {
				...process.env,
				PORT: String(port),
				HOST: '127.0.0.1',
				DATA_DIR: SERVER_DATA_DIR,
				PUBLIC_BASE_URL: baseUrl,
				STAFF_EMAILS: STAFF.email,
				STAFF_PASSWORD: STAFF.password,
				WORKER_POLL_MS: pollMs,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		child.stdout.on('data', () => {});
		child.stderr.on('data', (chunk) => {
			const text = chunk.toString();
			if (/error|exception/i.test(text)) {
				console.log(`[server:${label}] ${text.trim().slice(0, 400)}`);
			}
		});
		const entry = {
			baseUrl,
			close: async () => {
				if (child.exitCode !== null || child.signalCode !== null) {
					return;
				}
				child.kill();
				await pollUntil(
					`${label} exit`,
					async () =>
						child.exitCode !== null || child.signalCode !== null,
					10_000,
					100,
				).catch(() => {
					if (process.platform === 'win32') {
						spawn(
							'taskkill',
							['/pid', String(child.pid), '/T', '/F'],
							{
								stdio: 'ignore',
							},
						);
					}
				});
			},
		};
		running.push(entry);
		await pollUntil(`${label} ready`, async () => {
			const probe = await api(baseUrl, 'GET', '/', {
				origin: null,
			}).catch(() => null);
			return probe?.status === 200;
		});
		return entry;
	}
	start.running = running;
	return start;
}

// ---------------------------------------------------------------------------
// Minimal CDP client over Node 26 built-in WebSocket
// ---------------------------------------------------------------------------

class Cdp {
	constructor(wsUrl) {
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = [];
		this.ws = new WebSocket(wsUrl);
		this.closed = false;
	}

	async open() {
		await new Promise((resolve, reject) => {
			this.ws.addEventListener('open', resolve, { once: true });
			this.ws.addEventListener(
				'error',
				() => reject(new Error('CDP WebSocket failed to open')),
				{ once: true },
			);
		});
		this.ws.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== undefined) {
				const entry = this.pending.get(message.id);
				if (entry) {
					this.pending.delete(message.id);
					if (message.error) {
						entry.reject(
							new Error(
								`CDP ${entry.method}: ${message.error.message}`,
							),
						);
					} else {
						entry.resolve(message.result ?? {});
					}
				}
				return;
			}
			if (message.method) {
				for (const listener of this.listeners) {
					if (listener.method === message.method) {
						listener.handler(
							message.params ?? {},
							message.sessionId ?? null,
						);
					}
				}
			}
		});
		this.ws.addEventListener('close', () => {
			this.closed = true;
			for (const entry of [...this.pending.values()]) {
				entry.reject(new Error('CDP WebSocket closed'));
			}
			this.pending.clear();
		});
	}

	send(method, params = {}, sessionId = undefined) {
		if (this.closed) {
			return Promise.reject(new Error('CDP connection already closed'));
		}
		const id = this.nextId++;
		const message = { id, method, params };
		if (sessionId !== undefined) {
			message.sessionId = sessionId;
		}
		return new Promise((resolve, reject) => {
			this.pending.set(id, { method, resolve, reject });
			this.ws.send(JSON.stringify(message));
		});
	}

	on(method, handler) {
		this.listeners.push({ method, handler });
	}

	waitEvent(
		method,
		{ sessionId = null, timeoutMs = 30_000, filter = null } = {},
	) {
		return new Promise((resolve, reject) => {
			const entry = { method, handler: null };
			const timer = setTimeout(() => {
				const index = this.listeners.indexOf(entry);
				if (index >= 0) {
					this.listeners.splice(index, 1);
				}
				reject(new Error(`timeout waiting for CDP event ${method}`));
			}, timeoutMs);
			entry.handler = (params, eventSessionId) => {
				if (sessionId !== null && eventSessionId !== sessionId) {
					return;
				}
				if (filter && !filter(params, eventSessionId)) {
					return;
				}
				clearTimeout(timer);
				const index = this.listeners.indexOf(entry);
				if (index >= 0) {
					this.listeners.splice(index, 1);
				}
				resolve({ params, sessionId: eventSessionId });
			};
			this.listeners.push(entry);
		});
	}

	close() {
		try {
			this.ws.close();
		} catch {
			// already gone
		}
	}
}

// ---------------------------------------------------------------------------
// Browser lifecycle (Edge/Chrome auto-detect; profile under tests/.data)
// ---------------------------------------------------------------------------

function findBrowserExecutable() {
	const candidates = [
		process.env.BROWSER_JOURNEY_BROWSER,
		// macOS
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		// Windows
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		`${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	].filter(Boolean);
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function launchBrowser() {
	const executable = findBrowserExecutable();
	if (!executable) {
		throw new Error(
			'no Chromium-class browser found (looked for Chrome and Edge in the standard Windows locations; set BROWSER_JOURNEY_BROWSER to override)',
		);
	}
	const cdpPort = await freePort();
	const headlessVariants =
		OPTIONS.headed ? [null] : ['--headless=new', '--headless'];
	let lastError = null;
	for (const headlessFlag of headlessVariants) {
		const args = [
			`--remote-debugging-port=${cdpPort}`,
			`--user-data-dir=${PROFILE_DIR}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-extensions',
			'--disable-background-networking',
			'--disable-sync',
			'--disable-gpu',
			'--window-size=1280,900',
			'--mute-audio',
		];
		if (headlessFlag) {
			args.push(headlessFlag);
		}
		const child = spawn(executable, args, {
			stdio: ['ignore', 'ignore', 'pipe'],
		});
		let stderrTail = '';
		child.stderr.on('data', (chunk) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-4000);
		});
		const kill = () => {
			if (process.platform === 'win32') {
				spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
					stdio: 'ignore',
				});
			} else {
				child.kill('SIGKILL');
			}
		};
		try {
			const version = await pollUntil(
				'CDP endpoint',
				async () => {
					const response = await fetch(
						`http://127.0.0.1:${cdpPort}/json/version`,
					).catch(() => null);
					const body = response?.ok ? await response.json() : null;
					return body ?? null;
				},
				20_000,
				250,
			);
			const cdp = new Cdp(version.webSocketDebuggerUrl);
			await cdp.open();
			return { cdp, child, kill, version, executable, cdpPort };
		} catch (error) {
			lastError = error;
			kill();
			console.log(
				`[browser] launch with ${headlessFlag ?? 'headed'} failed (${error.message}); stderr tail: ${stderrTail.split('\n').at(-1)?.slice(0, 200) ?? 'n/a'}`,
			);
		}
	}
	throw new Error(
		`could not start browser: ${lastError?.message ?? 'unknown'}`,
	);
}

// ---------------------------------------------------------------------------
// Page driver: one CDP session over one target inside one browser context
// ---------------------------------------------------------------------------

async function openPage(cdp, browserContextId = undefined) {
	const { targetId } = await cdp.send('Target.createTarget', {
		url: 'about:blank',
		browserContextId,
	});
	const { sessionId } = await cdp.send('Target.attachToTarget', {
		targetId,
		flatten: true,
	});
	for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) {
		await cdp.send(method, {}, sessionId);
	}
	const page = {
		sessionId,
		targetId,
		consoleErrors: [],
		net: new Map(), // requestId -> {url, method, postData}
		netLog: [], // finalized {url, method, status, postData}
	};
	cdp.on('Runtime.consoleAPICalled', (params, eventSessionId) => {
		if (eventSessionId !== sessionId || params.type !== 'error') {
			return;
		}
		const text = (params.args ?? [])
			.map((arg) => arg.value ?? arg.description ?? '')
			.join(' ');
		page.consoleErrors.push(text.slice(0, 300));
	});
	cdp.on('Runtime.exceptionThrown', (params, eventSessionId) => {
		if (eventSessionId !== sessionId) {
			return;
		}
		page.consoleErrors.push(
			(
				params.exceptionDetails?.exception?.description
				?? params.exceptionDetails?.text
				?? 'page exception'
			).slice(0, 300),
		);
	});
	cdp.on('Network.requestWillBeSent', (params, eventSessionId) => {
		if (eventSessionId !== sessionId) {
			return;
		}
		page.net.set(params.requestId, {
			url: params.request.url,
			method: params.request.method,
			postData: params.request.postData ?? null,
		});
	});
	const finalize = (requestId, status) => {
		const entry = page.net.get(requestId);
		if (!entry) {
			return;
		}
		page.net.delete(requestId);
		entry.status = status;
		entry.at = new Date().toISOString();
		page.netLog.push(entry);
	};
	cdp.on('Network.responseReceived', (params, eventSessionId) => {
		if (eventSessionId === sessionId) {
			finalize(params.requestId, params.response.status);
		}
	});
	cdp.on('Network.loadingFailed', (params, eventSessionId) => {
		if (eventSessionId === sessionId) {
			finalize(params.requestId, 0);
		}
	});
	page.close = async () => {
		await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
	};
	return page;
}

async function evaluate(cdp, page, expression) {
	const response = await cdp.send(
		'Runtime.evaluate',
		{ expression, returnByValue: true, awaitPromise: true },
		page.sessionId,
	);
	if (response.exceptionDetails) {
		throw new Error(
			`page eval failed: ${
				response.exceptionDetails.exception?.description
				?? response.exceptionDetails.text
			}`.slice(0, 400),
		);
	}
	return response.result?.value;
}

async function navigate(cdp, page, url) {
	const loaded = cdp.waitEvent('Page.loadEventFired', {
		sessionId: page.sessionId,
		timeoutMs: 45_000,
	});
	await cdp.send('Page.navigate', { url }, page.sessionId);
	await loaded;
	await pageReady(cdp, page);
}

async function pageReady(cdp, page) {
	await evaluate(
		cdp,
		page,
		`document.documentElement ? document.documentElement.outerHTML.length >= 0 : true`,
	).catch(() => {});
	await pollUntil(
		'document readyState complete',
		async () =>
			(await evaluate(cdp, page, 'document.readyState').catch(() => ''))
			=== 'complete',
		15_000,
		150,
	);
	await sleep(250);
}

async function currentUrl(cdp, page) {
	return evaluate(cdp, page, 'location.href');
}

async function bodyText(cdp, page) {
	return (
		(await evaluate(
			cdp,
			page,
			`document.body ? document.body.innerText : ''`,
		)) ?? ''
	);
}

async function screenshot(cdp, page, name, artifactsDir) {
	const response = await cdp.send(
		'Page.captureScreenshot',
		{ format: 'png', captureBeyondViewport: true },
		page.sessionId,
	);
	const file = path.join(artifactsDir, `${name}.png`);
	fs.writeFileSync(file, Buffer.from(response.data, 'base64'));
	return file;
}

async function waitText(cdp, page, pattern, timeoutMs = 15_000) {
	return pollUntil(
		`text ${pattern}`,
		async () => {
			const text = await bodyText(cdp, page);
			const match = text.match(pattern);
			return match ? match[0] : null;
		},
		timeoutMs,
		250,
	);
}

// ---------------------------------------------------------------------------
// Robust label/DOM matching (needs final UI calibration)
// ---------------------------------------------------------------------------

// Evaluated inside the page. spec:
//   { kinds: ['input','textarea','select','button','link','any'],
//     types: ['email','password',...],        // input type filter
//     match: ['regexSource', ...],            // normalized-text matchers
//     values: ['exactValue', ...],            // attribute/option exact values
//     exclude: ['regexSource', ...] }         // anti-patterns
// Returns a descriptor or null. Normalization folds ja/en spacing + case.
const MATCHER_SOURCE = `() => {
	const spec = __spec;
	const norm = (s) => (s ?? '').toString().normalize('NFKC').toLowerCase().replace(/[\\s\\u3000]+/g, '');
	const matches = new Set((spec.match ?? []).map((s) => new RegExp(s, 'i')));
	const excludes = new Set((spec.exclude ?? []).map((s) => new RegExp(s, 'i')));
	const values = new Set((spec.values ?? []).map((v) => norm(v)));
	const isExcluded = (text) => [...excludes].some((re) => re.test(text));
	const hit = (text) => {
		const n = norm(text);
		if (!n || isExcluded(n)) {
			return false;
		}
		return [...matches].some((re) => re.test(n)) || values.has(n);
	};
	const labelTextFor = (el) => {
		const parts = [];
		if (el.id) {
			for (const label of document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]')) {
				parts.push(label.innerText);
			}
		}
		const wrap = el.closest('label');
		if (wrap) {
			parts.push(wrap.innerText);
		}
		const labelledby = el.getAttribute('aria-labelledby');
		if (labelledby) {
			for (const id of labelledby.split(/\\s+/)) {
				const node = document.getElementById(id);
				if (node) {
					parts.push(node.innerText);
				}
			}
		}
		parts.push(el.getAttribute('aria-label'), el.placeholder, el.title, el.name, el.id);
		return parts.filter(Boolean).join(' ');
	};
	const controlText = (el) => {
		if (el instanceof HTMLSelectElement) {
			return labelTextFor(el) + ' ' + [...el.options].map((o) => o.textContent + ' ' + o.value).join(' ');
		}
		return labelTextFor(el) + ' ' + (el.value ?? '');
	};
	const actionable = (el) => {
		const text = (el.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '') + ' ' + (el.title ?? '') + ' ' + (el.value ?? '');
		return text;
	};
	const role = (el) => el.getAttribute('role') ?? '';
	const kinds = new Set(spec.kinds ?? ['any']);
	const wantControls = kinds.has('input') || kinds.has('textarea') || kinds.has('select');
	const wantClick = kinds.has('button') || kinds.has('link');
	const candidates = [];
	for (const el of document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], [role="tab"], summary')) {
		const kind = el.tagName === 'INPUT' ? 'input' : el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : el.tagName === 'BUTTON' || role(el) === 'button' || el.tagName === 'SUMMARY' ? 'button' : 'link';
		if (!kinds.has('any') && !kinds.has(kind)) {
			continue;
		}
		if (spec.inForm && !el.closest('form')) {
			continue;
		}
		if (el instanceof HTMLInputElement && (spec.types ?? []).length > 0 && !(spec.types ?? []).includes((el.type || 'text').toLowerCase())) {
			continue;
		}
		const text = wantClick ? actionable(el) : controlText(el);
		if (!hit(text) && !(el instanceof HTMLInputElement && hit(el.getAttribute('data-testid') ?? ''))) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		const style = getComputedStyle(el);
		const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
		let score = visible ? 10 : 0;
		if (el instanceof HTMLInputElement && (spec.types ?? []).includes((el.type || 'text').toLowerCase())) {
			score += 5;
		}
		if (el.getAttribute('aria-label') && hit(el.getAttribute('aria-label'))) {
			score += 4;
		}
		if ([...document.querySelectorAll('label')].some((l) => l.innerText && hit(l.innerText) && (l.control === el || (el.id && l.htmlFor === el.id)))) {
			score += 3;
		}
		if (el.checkVisibility ? el.checkVisibility() : visible) {
			score += 2;
		}
		// Real submit controls beat nav buttons/links with identical labels.
		if (el.type === 'submit') {
			score += 6;
		}
		if (el.closest('form')) {
			score += 3;
		}
		if (el.tagName === 'A' && el.hasAttribute('href')) {
			score -= 4;
		}
		if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
			score -= 1;
		}
		candidates.push({ el, score, kind, text: norm(text).slice(0, 80), visible });
	}
	candidates.sort((a, b) => b.score - a.score);
	const best = candidates[0];
	if (!best) {
		return null;
	}
	const el = best.el;
	const rect = el.getBoundingClientRect();
	return {
		tag: el.tagName.toLowerCase(),
		type: el.type ?? null,
		id: el.id ?? null,
		name: el.name ?? null,
		ariaLabel: el.getAttribute('aria-label'),
		placeholder: el.placeholder ?? null,
		checked: el.checked ?? null,
		disabled: el.disabled ?? el.getAttribute('aria-disabled') === 'true',
		options: el instanceof HTMLSelectElement ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : undefined,
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		visible: best.visible,
		score: best.score,
		matchedText: best.text,
		kind: best.kind,
	};
}
`;

async function findElement(cdp, page, spec) {
	const expression = `(() => { window.__spec = ${JSON.stringify(spec)}; return (${MATCHER_SOURCE})(); })()`;
	return evaluate(cdp, page, expression);
}

async function findOrFail(cdp, page, spec, pendingReason) {
	const descriptor = await findElement(cdp, page, spec);
	if (!descriptor) {
		const error = new Error(pendingReason);
		error.pending = true;
		throw error;
	}
	return descriptor;
}

async function scrollToElement(cdp, page, spec) {
	await evaluate(
		cdp,
		page,
		`(() => {
			window.__spec = ${JSON.stringify(spec)};
			const finder = ${MATCHER_SOURCE};
			const d = finder();
			if (d) {
				const el = d.id ? document.getElementById(d.id) : [...document.querySelectorAll(d.tag)].find(candidate => {
					const bounds = candidate.getBoundingClientRect();
					return bounds.x === d.rect.x && bounds.y === d.rect.y && bounds.width === d.rect.width && bounds.height === d.rect.height;
				});
				const target = el && (el.closest('input,textarea,select,button,a,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[role="link"],[role="tab"],summary') ?? el);
				if (target) {
					target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
				}
			}
			return d ? d.rect : null;
		})()`,
	);
	await sleep(120);
	return findElement(cdp, page, spec);
}

async function clickElement(cdp, page, spec, label) {
	const descriptor = await scrollToElement(cdp, page, spec);
	if (!descriptor) {
		const error = new Error(`no element matches ${label}`);
		error.pending = true;
		throw error;
	}
	if (descriptor.disabled) {
		return { descriptor, clicked: false };
	}
	// Visually hidden inputs (e.g. styled consent checkboxes) delegate their
	// clicks to the wrapping/explicit label — click the label instead.
	let rect = descriptor.rect;
	if (descriptor.tag === 'input' && !descriptor.visible) {
		const labelRect = await evaluate(
			cdp,
			page,
			`(() => {
				window.__spec = ${JSON.stringify(spec)};
				const d = (${MATCHER_SOURCE})();
				const el = d && (document.getElementById(d.id) ?? document.querySelector('input[name="' + CSS.escape(d.name ?? '') + '"]'));
				if (!el) {
					return null;
				}
				const label = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) ?? el.closest('label');
				if (!label) {
					return null;
				}
				const rect = label.getBoundingClientRect();
				return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
			})()`,
		);
		if (labelRect && labelRect.width > 0) {
			rect = labelRect;
		}
	}
	const x = rect.x + rect.width / 2;
	const y = rect.y + rect.height / 2;
	for (const type of ['mousePressed', 'mouseReleased']) {
		await cdp.send(
			'Input.dispatchMouseEvent',
			{
				type,
				x,
				y,
				button: 'left',
				clickCount: 1,
			},
			page.sessionId,
		);
	}
	return { descriptor, clicked: true };
}

async function fillField(cdp, page, spec, text, label) {
	const { descriptor } = await clickElement(cdp, page, spec, label);
	await evaluate(
		cdp,
		page,
		`(() => {
			window.__spec = ${JSON.stringify(spec)};
			const d = (${MATCHER_SOURCE})();
			const el = d ? document.getElementById(d.id) ?? document.querySelector(d.tag + (d.name ? '[name="' + CSS.escape(d.name) + '"]' : '')) : null;
			if (!el) {
				return 'element-gone';
			}
			window.__ojLast = el;
			if (document.activeElement !== el) {
				el.focus();
			}
			el.value = '';
			return 'ok';
		})()`,
	);
	await cdp.send('Input.insertText', { text: String(text) }, page.sessionId);
	const value = await evaluate(
		cdp,
		page,
		`window.__ojLast && window.__ojLast.isConnected ? window.__ojLast.value : null`,
	);
	if (value !== String(text)) {
		throw new Error(
			`fill ${label}: expected ${JSON.stringify(String(text))} in the field, got ${JSON.stringify(value)} (descriptor: ${JSON.stringify(descriptor)})`,
		);
	}
	return descriptor;
}

async function selectOption(cdp, page, spec, value, label) {
	// <select> has no reliable synthetic mouse path in headless CDP; set the
	// value directly and fire real input+change events (documented shortcut).
	const result = await evaluate(
		cdp,
		page,
		`(() => {
			window.__spec = ${JSON.stringify(spec)};
			const d = (${MATCHER_SOURCE})();
			if (!d || d.tag !== 'select') {
				return { found: false, descriptor: d };
			}
			const el = document.getElementById(d.id) ?? document.querySelector('select[name="' + CSS.escape(d.name ?? '') + '"]');
			if (!el) {
				return { found: false, descriptor: d };
			}
			const wanted = ${JSON.stringify(String(value))}.normalize('NFKC').toLowerCase().replace(/[\\s\\u3000]+/g, '');
			const index = [...el.options].findIndex((o) => {
				const value = (o.value ?? '').normalize('NFKC').toLowerCase().replace(/[\\s\\u3000]+/g, '');
				const text = (o.textContent ?? '').normalize('NFKC').toLowerCase().replace(/[\\s\\u3000]+/g, '');
				return value === wanted || text === wanted;
			});
			if (index < 0) {
				return { found: true, matched: false, options: [...el.options].map((o) => o.value + ':' + o.textContent.trim()) };
			}
			el.selectedIndex = index;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return { found: true, matched: true, value: el.value };
		})()`,
	);
	if (!result?.found) {
		const error = new Error(`no <select> matches ${label}`);
		error.pending = true;
		throw error;
	}
	if (!result.matched) {
		const error = new Error(
			`select ${label}: option ${JSON.stringify(String(value))} not found (options: ${JSON.stringify(result.options)})`,
		);
		error.pending = true;
		throw error;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Locale switcher heuristic (contract: every owner-facing string in ja + en)
// ---------------------------------------------------------------------------

async function checkLocaleSwitch(cdp, page, label) {
	const switcher = await evaluate(
		cdp,
		page,
		`(() => {
			const norm = (s) => (s ?? '').toString().normalize('NFKC').toLowerCase().replace(/[\\s\\u3000]+/g, '');
			const localeRe = /(日本語|えいご|英語|english|language|言語|切替|切换|switch|^ja$|^en$)/;
			const select = [...document.querySelectorAll('select')].find((el) => {
				const values = [...el.options].map((o) => norm(o.value));
				return values.includes('ja') && values.includes('en');
			});
			if (select) {
				window.__ojLocaleSelect = select;
				return { kind: 'select', id: select.id ?? null, name: select.name ?? null, ariaLabel: select.getAttribute('aria-label') };
			}
			const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="switch"], [role="tab"], label, input[type="radio"], input[type="checkbox"]')];
			const options = candidates
				.map((el) => ({
					el,
					text: norm((el.innerText ?? '') + ' ' + (el.getAttribute('aria-label') ?? '') + ' ' + (el.title ?? '') + ' ' + (el.value ?? '')),
				}))
				.filter((entry) => localeRe.test(entry.text) && entry.text.length <= 40);
			const english = options.find((entry) => /(english|えいご|英語|^en$)/.test(entry.text)) ?? options[0];
			if (!english) {
				return null;
			}
			const rect = english.el.getBoundingClientRect();
			return {
				kind: 'click',
				text: english.text.slice(0, 40),
				rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
			};
		})()`,
	);
	if (!switcher) {
		return {
			status: 'PENDING',
			detail: `locale switcher not recognized on ${label} (needs final UI calibration)`,
		};
	}
	const before = {
		lang: await evaluate(cdp, page, 'document.documentElement.lang'),
		text: (await bodyText(cdp, page)).slice(0, 4000),
	};
	if (switcher.kind === 'select') {
		const switched = await evaluate(
			cdp,
			page,
			`(() => {
				const sel = window.__ojLocaleSelect;
				if (!sel || !sel.isConnected) {
					return 'missing';
				}
				const index = [...sel.options].findIndex((o) => o.value === 'en' || (o.textContent ?? '').trim().toLowerCase() === 'english');
				if (index < 0) {
					return 'no-en-option';
				}
				sel.selectedIndex = index;
				sel.dispatchEvent(new Event('input', { bubbles: true }));
				sel.dispatchEvent(new Event('change', { bubbles: true }));
				return 'ok';
			})()`,
		);
		if (switched !== 'ok') {
			return {
				status: 'FAIL',
				detail: `locale select found on ${label} but switching to en failed (${switched})`,
			};
		}
	} else {
		await cdp.send(
			'Input.dispatchMouseEvent',
			{
				type: 'mousePressed',
				x: switcher.rect.x + switcher.rect.width / 2,
				y: switcher.rect.y + switcher.rect.height / 2,
				button: 'left',
				clickCount: 1,
			},
			page.sessionId,
		);
		await cdp.send(
			'Input.dispatchMouseEvent',
			{
				type: 'mouseReleased',
				x: switcher.rect.x + switcher.rect.width / 2,
				y: switcher.rect.y + switcher.rect.height / 2,
				button: 'left',
				clickCount: 1,
			},
			page.sessionId,
		);
	}
	await sleep(900);
	const after = {
		lang: await evaluate(cdp, page, 'document.documentElement.lang'),
		text: (await bodyText(cdp, page)).slice(0, 4000),
	};
	const changed = before.text !== after.text || before.lang !== after.lang;
	if (!changed) {
		return {
			status: 'FAIL',
			detail: `locale switcher found (${switcher.kind}) on ${label} but no visible text or <html lang> changed`,
		};
	}
	return {
		status: 'PASS',
		detail: `switched via ${switcher.kind} on ${label} (lang ${before.lang || '?'} → ${after.lang || '?'})`,
	};
}

// ---------------------------------------------------------------------------
// Route implementation probe (404 ⇒ PENDING before touching the browser)
// ---------------------------------------------------------------------------

async function probeRoute(baseUrl, pathname, jar) {
	const response = await api(baseUrl, 'GET', pathname, {
		jar,
		origin: null,
	}).catch(() => null);
	return response?.status ?? 0;
}

// ---------------------------------------------------------------------------
// API seeding (synthetic owners; the browser then verifies the UI against it)
// ---------------------------------------------------------------------------

async function seedOwnerJourney(baseUrl, owner, transcript) {
	const jar = newCookieJar();
	const signup = await api(baseUrl, 'POST', '/api/auth/signup', {
		body: owner,
		jar,
	});
	if (signup.status !== 201) {
		throw new Error(
			`seed signup ${owner.email} failed: HTTP ${signup.status} ${signup.text.slice(0, 200)}`,
		);
	}
	const start = await api(baseUrl, 'POST', '/api/interviews/start', {
		body: { consent: true, mode: 'demo' },
		jar,
	});
	if (start.status !== 201) {
		throw new Error(
			`seed interview start failed: HTTP ${start.status} ${start.text.slice(0, 200)}`,
		);
	}
	const complete = await api(
		baseUrl,
		'POST',
		`/api/interviews/${start.json.interview.id}/complete`,
		{ body: { transcript }, jar },
	);
	if (complete.status !== 200) {
		throw new Error(
			`seed interview complete failed: HTTP ${complete.status} ${complete.text.slice(0, 200)}`,
		);
	}
	const reportId = complete.json.reportId;
	const ready = await pollUntil(
		`seed report ${reportId} ready`,
		async () => {
			const detail = await api(
				baseUrl,
				'GET',
				`/api/reports/${reportId}`,
				{
					jar,
					origin: null,
				},
			);
			return detail.json?.report?.status === 'ready' ? detail : null;
		},
		30_000,
		400,
	);
	return { jar, reportId, content: ready.json.report.content };
}

// ---------------------------------------------------------------------------
// Download capture (Browser.setDownloadBehavior per browser context)
// ---------------------------------------------------------------------------

async function waitForNewDownload(downloadsDir, before, timeoutMs = 15_000) {
	return pollUntil(
		'download file appears',
		async () => {
			const entries =
				fs.existsSync(downloadsDir) ? fs.readdirSync(downloadsDir) : [];
			const fresh = entries.filter(
				(name) => !before.has(name) && !name.endsWith('.crdownload'),
			);
			if (fresh.length === 0) {
				return null;
			}
			const file = path.join(downloadsDir, fresh[0]);
			const size = fs.statSync(file).size;
			await sleep(400);
			return fs.statSync(file).size === size ?
					{ file, name: fresh[0], size }
				:	null;
		},
		timeoutMs,
		300,
	);
}

// ---------------------------------------------------------------------------
// Journey phases
// ---------------------------------------------------------------------------

async function runSmokeChecks(cdp, contextId, baseUrl, artifactsDir) {
	const page = await openPage(cdp, contextId);
	const startedAt = Date.now();
	try {
		await navigate(cdp, page, `${baseUrl}/`);
		const title = await evaluate(cdp, page, 'document.title');
		const text = await bodyText(cdp, page);
		if (text.trim().length === 0) {
			record('smoke.homepage-renders', 'FAIL', 'homepage body is empty');
		} else {
			record(
				'smoke.homepage-renders',
				'PASS',
				`200, title ${JSON.stringify(title)}, ${text.trim().length} chars of visible text`,
			);
		}
		const session = await evaluate(
			cdp,
			page,
			`fetch('/api/auth/session', { headers: { accept: 'application/json' } }).then((r) => r.json())`,
		);
		if (session && 'user' in session && session.user === null) {
			record(
				'smoke.api-session-null',
				'PASS',
				'GET /api/auth/session from the page returned { user: null }',
			);
		} else {
			record(
				'smoke.api-session-null',
				'FAIL',
				`unexpected session payload ${JSON.stringify(session).slice(0, 200)}`,
			);
		}
		const shot = await screenshot(cdp, page, '01-smoke-home', artifactsDir);
		record(
			'smoke.screenshot-captured',
			fs.existsSync(shot) ? 'PASS' : 'FAIL',
			shot,
		);
		const errors = page.consoleErrors.filter(
			(line) => !/favicon/i.test(line),
		);
		record(
			'smoke.no-console-errors',
			errors.length === 0 ? 'PASS' : 'FAIL',
			errors.length === 0 ?
				'no page errors on the homepage'
			:	errors.slice(0, 3).join(' | '),
		);
	} finally {
		await page.close();
	}
	return Date.now() - startedAt;
}

// Locale switching in a throwaway context: activating the switcher persists
// a locale choice, so it must not leak into the other checks' contexts.
async function runLocaleSwitchCheck(cdp, baseUrl, artifactsDir) {
	const { browserContextId } = await cdp.send('Target.createBrowserContext', {
		disposeOnDetach: false,
	});
	const page = await openPage(cdp, browserContextId);
	try {
		await navigate(cdp, page, `${baseUrl}/`);
		const locale = await checkLocaleSwitch(cdp, page, '/');
		record('i18n.locale-switch-home', locale.status, locale.detail);
		await screenshot(cdp, page, '05-locale-switched', artifactsDir);
	} catch (error) {
		record('i18n.locale-switch-home', 'FAIL', error.message);
	} finally {
		await page.close();
		await cdp
			.send('Target.disposeBrowserContext', { browserContextId })
			.catch(() => {});
	}
}

// Signup through the UI (contract §4/§5). PENDING while /signup is in flight.
async function runSignupUiCheck(cdp, contextId, baseUrl, artifactsDir) {
	const page = await openPage(cdp, contextId);
	try {
		await navigate(cdp, page, `${baseUrl}/signup`);
		await screenshot(cdp, page, '10-signup-landing', artifactsDir);
		const email = `ui-signup-${crypto.randomUUID().slice(0, 8)}@example.test`;
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['email', 'text'],
				match: ['email', 'メール', 'mail'],
			},
			email,
			'signup email',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['password'],
				match: ['password', 'パスワード'],
			},
			OWNER_UI.password,
			'signup password',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['text'],
				match: [
					'お名前|氏名|代表者|担当者|your.?name|owner.?name|^name$',
				],
			},
			OWNER_UI.profile.name,
			'signup owner name',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['text'],
				match: ['business.*name|事業.*名|宿.*名|屋号'],
			},
			OWNER_UI.profile.businessName,
			'signup business name',
		);
		await selectOption(
			cdp,
			page,
			{
				kinds: ['select'],
				match: ['business.*type|業種|事業の種別|種別'],
			},
			OWNER_UI.profile.businessType,
			'signup businessType',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input', 'textarea'],
				match: ['municipality|市町村|自治体|地域'],
			},
			OWNER_UI.profile.municipality,
			'signup municipality',
		);
		const submit = await findOrFail(
			cdp,
			page,
			{
				kinds: ['button', 'link'],
				inForm: true,
				match: ['登録|登録する|sign.?up|create|始める|register|submit'],
			},
			'signup submit control not found — /signup UI needs final implementation',
		);
		if (submit.disabled) {
			record(
				'signup.ui-form',
				'PENDING',
				'submit is disabled (form incomplete)',
			);
			return;
		}
		await clickElement(
			cdp,
			page,
			{
				kinds: ['button', 'link'],
				inForm: true,
				match: ['登録|登録する|sign.?up|create|始める|register|submit'],
			},
			'signup submit',
		);
		await pollUntil(
			'signup completion',
			async () => !(await currentUrl(cdp, page)).includes('/signup'),
			15_000,
			300,
		).catch(() => {});
		// The session cookie lives in the browser context (HttpOnly); read it
		// back over CDP and verify it against the API from Node.
		const cookiePage = await openPage(cdp, contextId);
		let sessionCookie = null;
		try {
			const cookieList = await cdp.send(
				'Network.getCookies',
				{ urls: [baseUrl] },
				cookiePage.sessionId,
			);
			sessionCookie = (cookieList.cookies ?? []).find(
				(cookie) => cookie.name === 'session',
			);
		} finally {
			await cookiePage.close();
		}
		const session =
			sessionCookie ?
				await api(baseUrl, 'GET', '/api/auth/session', {
					origin: null,
					headers: { cookie: `session=${sessionCookie.value}` },
				})
			:	null;
		if (session?.json?.user?.role === 'owner') {
			record(
				'signup.ui-form',
				'PASS',
				`UI signup created an owner session for ${email}`,
			);
		} else {
			record(
				'signup.ui-form',
				'FAIL',
				`submit did not establish an owner session (cookie: ${sessionCookie ? 'present' : 'missing'}, HTTP ${session?.status ?? 'n/a'}, url ${await currentUrl(cdp, page)})`,
			);
		}
	} catch (error) {
		await screenshot(cdp, page, '11-signup-failure', artifactsDir).catch(
			() => {},
		);
		record(
			'signup.ui-form',
			error.pending ? 'PENDING' : 'FAIL',
			error.message,
		);
	} finally {
		await page.close();
	}
}

// Sign-in page honoring ?next= (contract: mail link returns to the report).
async function runSignInChecks(
	cdp,
	contextId,
	baseUrl,
	reportId,
	artifactsDir,
) {
	const page = await openPage(cdp, contextId);
	try {
		await navigate(
			cdp,
			page,
			`${baseUrl}/sign-in?next=${encodeURIComponent(`/reports/${reportId}`)}`,
		);
		await screenshot(cdp, page, '20-signin-landing', artifactsDir);
		// Negative: wrong password must not redirect.
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['email', 'text'],
				match: ['email', 'メール'],
			},
			OWNER_A.email,
			'sign-in email',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['password'],
				match: ['password', 'パスワード'],
			},
			'wrong-password-0000',
			'sign-in password',
		);
		await clickElement(
			cdp,
			page,
			{
				kinds: ['button', 'link'],
				inForm: true,
				match: ['ログイン|サインイン|sign.?in|log.?in|送信'],
			},
			'sign-in submit',
		);
		await sleep(1200);
		const badUrl = await currentUrl(cdp, page);
		if (!/sign-in/i.test(badUrl)) {
			record(
				'signin.wrong-password-stays',
				'FAIL',
				`wrong password redirected to ${badUrl}`,
			);
		} else {
			record('signin.wrong-password-stays', 'PASS', 'stayed on /sign-in');
		}
		// Positive: correct owner credentials honor ?next=.
		await navigate(
			cdp,
			page,
			`${baseUrl}/sign-in?next=${encodeURIComponent(`/reports/${reportId}`)}`,
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['email', 'text'],
				match: ['email', 'メール'],
			},
			OWNER_A.email,
			'sign-in email',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['password'],
				match: ['password', 'パスワード'],
			},
			OWNER_A.password,
			'sign-in password',
		);
		await clickElement(
			cdp,
			page,
			{
				kinds: ['button', 'link'],
				inForm: true,
				match: ['ログイン|サインイン|sign.?in|log.?in|送信'],
			},
			'sign-in submit',
		);
		await pollUntil(
			'redirect to next report',
			async () => {
				const url = await currentUrl(cdp, page);
				return (
					new URL(url).pathname === `/reports/${reportId}`
					&& (await bodyText(cdp, page)).includes(
						OWNER_A.profile.businessName,
					)
				);
			},
			15_000,
			300,
		);
		const finalUrl = await currentUrl(cdp, page);
		const text = await bodyText(cdp, page);
		const ok =
			finalUrl.includes(`/reports/${reportId}`)
			&& text.includes(OWNER_A.profile.businessName);
		record(
			'signin.next-redirect-to-report',
			ok ? 'PASS' : 'FAIL',
			`landed on ${finalUrl}${ok ? '' : `; page text: ${text.slice(0, 200)}`}`,
		);
		await screenshot(cdp, page, '21-signin-after-next', artifactsDir);
	} catch (error) {
		await screenshot(cdp, page, '22-signin-failure', artifactsDir).catch(
			() => {},
		);
		record(
			error.pending ? 'signin.ui' : 'signin.next-redirect-to-report',
			error.pending ? 'PENDING' : 'FAIL',
			error.message,
		);
	} finally {
		await page.close();
	}
}

// Interview UI: consent gate, demo-mode only, fictional label, scripted flow.
async function runInterviewUiChecks(cdp, contextId, baseUrl, artifactsDir) {
	const page = await openPage(cdp, contextId);
	const click = (selector) =>
		evaluate(
			cdp,
			page,
			`document.querySelector(${JSON.stringify(selector)}).click()`,
		);
	const waitFor = (expression) =>
		pollUntil(expression, () => evaluate(cdp, page, expression));
	try {
		await navigate(cdp, page, `${baseUrl}/interview`);
		const intro = 'section:has(#interview-intro-heading) button';
		await waitFor(
			`Boolean(document.querySelector(${JSON.stringify(intro)}))`,
		);
		await click(intro);
		await waitFor(
			"document.querySelector('.interview-consent button')?.disabled",
		);
		await click('.interview-consent button');
		if (
			page.netLog.some((entry) =>
				entry.url.endsWith('/api/interviews/start'),
			)
		) {
			throw new Error('The interview started without consent');
		}
		record(
			'interview.consent-gate',
			'PASS',
			'Start stays disabled until all three approvals',
		);
		for (const field of ['processing', 'privacy', 'staff']) {
			await click(`#interview-consent-${field}`);
		}
		await click('.interview-consent button');
		await waitFor("Boolean(document.querySelector('.interview-script'))");
		await waitText(
			cdp,
			page,
			/サンプル面談（フィクション）|Sample interview \(fictional\)/i,
		);
		const deadline = await evaluate(
			cdp,
			page,
			`fetch('/api/interviews/current').then(response => response.json()).then(data => data.interview?.deadlineAt)`,
		);
		const remaining = Date.parse(deadline) - Date.now();
		if (remaining <= 3_540_000 || remaining > 3_600_000) {
			throw new Error('Incorrect server deadline');
		}
		record(
			'interview.start',
			'PASS',
			'Fictional interview started with a one-hour server deadline',
		);
		await click('.interview-script button.button-secondary');
		await waitFor(
			"Boolean(document.querySelector('#interview-transcript-input')?.value)",
		);
		await click('[aria-labelledby="interview-submit-heading"] button');
		await waitFor(
			"Boolean(document.querySelector('section:has(#interview-submitted-heading) a'))",
		);
		await click('section:has(#interview-submitted-heading) a');
		await waitFor("location.pathname.startsWith('/reports/')");
		await waitText(cdp, page, /ルールベース|rule-based/i);
		record(
			'interview.scripted-flow-submit',
			'PASS',
			'Browser submitted the fictional transcript and rendered a ready report',
		);
		await screenshot(cdp, page, '32-interview-submitted', artifactsDir);
	} catch (error) {
		await screenshot(cdp, page, '33-interview-failure', artifactsDir).catch(
			() => {},
		);
		record('interview.flow', 'FAIL', error.message);
	} finally {
		await page.close();
	}
}

// Report review/download/consultation through the UI (owner context).
async function runReportUiChecks(
	cdp,
	contextId,
	baseUrl,
	reportId,
	artifactsDir,
	tag,
) {
	const page = await openPage(cdp, contextId);
	try {
		await navigate(cdp, page, `${baseUrl}/reports/${reportId}`);
		await screenshot(cdp, page, `40-${tag}-report-landing`, artifactsDir);
		const text = await bodyText(cdp, page);
		const label = text.match(
			/自動下書き（ルールベース）|Automated draft \(rule-based\)/i,
		)?.[0];
		record(
			`report.${tag}.rule-based-label`,
			label ? 'PASS' : 'FAIL',
			label ?
				`visible: ${label}`
			:	`label not visible on /reports/${reportId} — /reports UI needs final implementation`,
		);
		if (!label) {
			return;
		}
		const contentOk =
			text.includes(OWNER_A.profile.businessName)
			&& /人手|人材|採用|staffing|hire/i.test(text);
		record(
			`report.${tag}.content-rendered`,
			contentOk ? 'PASS' : 'FAIL',
			contentOk ?
				'business name and staffing section rendered'
			:	'expected report content missing from the page',
		);
		// Download via the UI; compare bytes with the API attachment.
		const before = new Set(
			fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR) : [],
		);
		const downloadSpec = {
			kinds: ['button', 'link'],
			match: ['ダウンロード|download|\\.md|markdown|保存'],
		};
		const downloadDescriptor = await findElement(cdp, page, downloadSpec);
		if (!downloadDescriptor) {
			record(
				`report.${tag}.download-md`,
				'PENDING',
				'download control not found (needs final UI calibration)',
			);
		} else {
			await evaluate(
				cdp,
				page,
				`document.querySelector('.report-actions a[href$="/download"]').click()`,
			);
			const downloaded = await waitForNewDownload(DOWNLOADS_DIR, before);
			if (!downloaded) {
				record(
					`report.${tag}.download-md`,
					'FAIL',
					'clicking download produced no file in the downloads dir',
				);
			} else {
				const ownerCookie = ownerJar.map.get('session');
				const apiDownload = await api(
					baseUrl,
					'GET',
					`/api/reports/${reportId}/download`,
					{
						origin: null,
						headers: { cookie: `session=${ownerCookie}` },
					},
				);
				const fileText = fs.readFileSync(downloaded.file, 'utf8');
				const same = fileText === apiDownload.text;
				record(
					`report.${tag}.download-md`,
					same && /report-/.test(downloaded.name) ? 'PASS' : 'FAIL',
					`${downloaded.name} (${downloaded.size}B)${same ? ' — bytes identical to GET /api/reports/:id/download' : ' — content differs from the API attachment'}`,
				);
			}
		}
		// The UI replaces the request button with a confirmation; API tests cover repeated requests.
		const consultSpec = {
			kinds: ['button', 'link'],
			match: ['相談|consultation|コンサル|予約'],
			exclude: ['キャンセル|cancel'],
		};
		const consultDescriptor = await findElement(cdp, page, consultSpec);
		if (!consultDescriptor) {
			record(
				`report.${tag}.consultation-idempotent`,
				'PENDING',
				'consultation control not found (needs final UI calibration)',
			);
		} else {
			const textBeforeConsult = await bodyText(cdp, page);
			const netAtConsult = page.netLog.length;
			await clickElement(cdp, page, consultSpec, 'consultation request');
			await sleep(1200);
			const calls = page.netLog
				.slice(netAtConsult)
				.filter((entry) => /\/consultation/.test(entry.url));
			const firstOk = calls.some((entry) => entry.status === 200);

			const textAfterConsult = await bodyText(cdp, page);
			const showedTimestamp =
				/(\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2})/.test(textAfterConsult)
				&& textAfterConsult !== textBeforeConsult;
			record(
				`report.${tag}.consultation-confirmation`,
				firstOk && showedTimestamp ? 'PASS' : 'FAIL',
				`Successful request: ${firstOk}; visible timestamp change: ${showedTimestamp}`,
			);
			const detail = await api(
				baseUrl,
				'GET',
				`/api/reports/${reportId}`,
				{
					origin: null,
					headers: {
						cookie: `session=${ownerJar.map.get('session')}`,
					},
				},
			);
			record(
				`report.${tag}.consultation-recorded`,
				detail.json?.report?.consultationRequestedAt ? 'PASS' : 'FAIL',
				`consultationRequestedAt = ${detail.json?.report?.consultationRequestedAt ?? 'null'}`,
			);
		}
	} catch (error) {
		await screenshot(
			cdp,
			page,
			`49-${tag}-report-failure`,
			artifactsDir,
		).catch(() => {});
		record(
			`report.${tag}.ui`,
			error.pending ? 'PENDING' : 'FAIL',
			error.message,
		);
	} finally {
		await page.close();
	}
}

// Voice chat entry: /voice must exist and degrade to an honest unavailable
// panel while the ELEVENLABS_* env is unset (this demo environment), and a
// staff session must see the role guard instead of the owner flow.
async function runVoicePageChecks(cdp, contextId, baseUrl, artifactsDir, role) {
	const page = await openPage(cdp, contextId);
	try {
		await navigate(cdp, page, `${baseUrl}/voice`);
		const text = await bodyText(cdp, page);
		const expected =
			role === 'staff' ?
				/職員アカウントでは音声面談を開始できません|Staff accounts cannot start a voice chat/
			:	/音声面談は現在利用できません|Voice chat is currently unavailable/;
		record(
			`voice.${role}-guard`,
			expected.test(text) ? 'PASS' : 'FAIL',
			expected.test(text) ?
				`/voice shows the ${role} guard panel (voice env unset)`
			:	`unexpected /voice content: ${text.slice(0, 160)}`,
		);
		await screenshot(cdp, page, `40-voice-${role}`, artifactsDir);
		const errors = page.consoleErrors.filter(
			(line) => !/favicon/i.test(line),
		);
		record(
			'voice.no-console-errors',
			errors.length === 0 ? 'PASS' : 'FAIL',
			errors.length === 0 ?
				`no page errors on /voice (${role})`
			:	errors.slice(0, 3).join(' | '),
		);
	} catch (error) {
		record(`voice.${role}-guard`, 'FAIL', error.message);
	} finally {
		await page.close();
	}
}

// Staff queue + walls (staff context).
async function runStaffChecks(
	cdp,
	contextId,
	baseUrl,
	reportIdA,
	reportIdB,
	artifactsDir,
) {
	const page = await openPage(cdp, contextId);
	try {
		await navigate(cdp, page, `${baseUrl}/staff`);
		await screenshot(cdp, page, '50-staff-queue', artifactsDir);
		const text = await bodyText(cdp, page);
		if (!text.trim()) {
			record(
				'staff.queue-renders',
				'PENDING',
				'/staff rendered empty (needs final implementation)',
			);
			return;
		}
		const hasA = text.includes(OWNER_A.profile.businessName);
		const hasB = text.includes(OWNER_B.profile.businessName);
		record(
			'staff.queue-renders',
			hasA && hasB ? 'PASS' : 'PENDING',
			hasA && hasB ?
				'both seeded owners visible in the queue'
			:	'queue does not show both seeded owners yet (needs final implementation)',
		);
		const indexA = text.indexOf(OWNER_A.profile.businessName);
		const indexB = text.indexOf(OWNER_B.profile.businessName);
		if (hasA && hasB) {
			// B was created (and completed) after A ⇒ newest first ⇒ B first.
			record(
				'staff.queue-newest-first',
				indexB >= 0 && indexB < indexA ? 'PASS' : 'FAIL',
				`owner B (newer) at ${indexB}, owner A (older) at ${indexA}`,
			);
		} else {
			record(
				'staff.queue-newest-first',
				'PENDING',
				'cannot verify order until both rows render',
			);
		}
		const consultVisible =
			/相談|consultation/i.test(text)
			&& text.indexOf(OWNER_A.profile.businessName) >= 0;
		record(
			'staff.consultation-flag',
			consultVisible ? 'PASS' : 'PENDING',
			consultVisible ?
				'consultation wording visible near the queue'
			:	'consultation flag not visible (needs final implementation)',
		);
		// Staff can open and download the owner's report.
		await navigate(cdp, page, `${baseUrl}/reports/${reportIdA}`);
		const staffText = await bodyText(cdp, page);
		const staffSees = staffText.includes(OWNER_A.profile.businessName);
		record(
			'staff.open-owner-report',
			staffSees ? 'PASS' : 'PENDING',
			staffSees ?
				'staff rendered owner A report'
			:	'staff report view did not render (needs final implementation)',
		);
		if (staffSees) {
			fs.rmSync(path.join(DOWNLOADS_DIR, `report-${reportIdA}.md`), {
				force: true,
			});
			const before = new Set(
				fs.existsSync(DOWNLOADS_DIR) ?
					fs.readdirSync(DOWNLOADS_DIR)
				:	[],
			);
			const downloadSpec = {
				kinds: ['button', 'link'],
				match: ['ダウンロード|download|\\.md|markdown|保存'],
			};
			if (await findElement(cdp, page, downloadSpec)) {
				await evaluate(
					cdp,
					page,
					`document.querySelector('.report-actions a[href$="/download"]').click()`,
				);
				const downloaded = await waitForNewDownload(
					DOWNLOADS_DIR,
					before,
				);
				record(
					'staff.download-owner-report',
					downloaded ? 'PASS' : 'FAIL',
					downloaded ?
						`${downloaded.name} (${downloaded.size}B)`
					:	'download click produced no file',
				);
			} else {
				record(
					'staff.download-owner-report',
					'PENDING',
					'download control not found (needs final UI calibration)',
				);
			}
		}
		// Staff cannot start an interview (no successful start call from UI).
		const startProbe = await openPage(cdp, contextId);
		try {
			await navigate(cdp, startProbe, `${baseUrl}/interview`);
			await sleep(1000);
			const startCalls = startProbe.netLog.filter((entry) =>
				/\/api\/interviews\/start/.test(entry.url),
			);
			const okStart = startCalls.some(
				(entry) => entry.status >= 200 && entry.status < 300,
			);
			const interviewText = await bodyText(cdp, startProbe);
			const stayedOnInterview = (
				await currentUrl(cdp, startProbe)
			).includes('/interview');
			record(
				'staff.no-interview-start',
				okStart ? 'FAIL' : 'PASS',
				okStart ?
					'staff UI managed to start an interview — contract violation'
				:	`no successful /api/interviews/start from the staff context (still on /interview: ${stayedOnInterview}; page: ${interviewText.slice(0, 80)})`,
			);
		} finally {
			await startProbe.close();
		}
	} catch (error) {
		await screenshot(cdp, page, '59-staff-failure', artifactsDir).catch(
			() => {},
		);
		record('staff.ui', error.pending ? 'PENDING' : 'FAIL', error.message);
	} finally {
		await page.close();
	}
}

// Access walls + persistence (owner + staff contexts).
async function runWallAndPersistenceChecks(
	cdp,
	ownerContextId,
	staffContextId,
	baseUrl,
	artifactsDir,
) {
	const page = await openPage(cdp, ownerContextId);
	try {
		// Owner B's report must be invisible to owner A's UI session.
		await navigate(cdp, page, `${baseUrl}/reports/${seedReportIdB}`);
		const text = await bodyText(cdp, page);
		const leaked = text.includes(OWNER_B.profile.businessName);
		record(
			'wall.owner-cannot-see-others-report',
			leaked ? 'FAIL' : 'PASS',
			leaked ?
				'owner A UI rendered owner B business name'
			:	'other owner report content not rendered (not_found UI or redirect)',
		);
		// Owner cannot see the staff queue data.
		await navigate(cdp, page, `${baseUrl}/staff`);
		const staffText = await bodyText(cdp, page);
		const queueLeaked = staffText.includes(OWNER_B.profile.businessName);
		record(
			'wall.owner-no-staff-queue',
			queueLeaked ? 'FAIL' : 'PASS',
			queueLeaked ?
				'owner UI rendered staff queue rows'
			:	'staff queue data not shown to the owner (walled or redirected)',
		);
		// Session persistence: reload keeps the owner signed in.
		await navigate(cdp, page, `${baseUrl}/`);
		await evaluate(
			cdp,
			page,
			`fetch('/api/auth/session', { headers: { accept: 'application/json' } }).then((r) => r.json())`,
		).then(async (session) => {
			record(
				'persist.owner-reload',
				session?.user?.role === 'owner' ? 'PASS' : 'FAIL',
				`session after reload: role=${session?.user?.role ?? 'none'}`,
			);
		});
	} catch (error) {
		await screenshot(cdp, page, '70-wall-failure', artifactsDir).catch(
			() => {},
		);
		record('wall.owner', error.pending ? 'PENDING' : 'FAIL', error.message);
	} finally {
		await page.close();
	}
	const staffPage = await openPage(cdp, staffContextId);
	try {
		await navigate(cdp, staffPage, `${baseUrl}/`);
		const session = await evaluate(
			cdp,
			staffPage,
			`fetch('/api/auth/session', { headers: { accept: 'application/json' } }).then((r) => r.json())`,
		);
		record(
			'persist.staff-reload',
			session?.user?.role === 'staff' ? 'PASS' : 'FAIL',
			`session after reload: role=${session?.user?.role ?? 'none'}`,
		);
	} catch (error) {
		record('persist.staff-reload', 'FAIL', error.message);
	} finally {
		await staffPage.close();
	}
}

// Mail: .eml shape + link round-trip through a signed-out context.
async function runMailChecks(
	cdp,
	publicContextId,
	baseUrl,
	reportIdA,
	artifactsDir,
) {
	const mailDir = path.join(SERVER_DATA_DIR, 'mail-outbox');
	if (!fs.existsSync(mailDir)) {
		record(
			'mail.eml-present',
			'PENDING',
			'no mail-outbox yet (BASE_URL mode cannot see the server data dir)',
		);
		return;
	}
	const files = fs
		.readdirSync(mailDir)
		.filter((name) => name.endsWith('.eml'));
	if (files.length === 0) {
		record(
			'mail.eml-present',
			'PENDING',
			'mail-outbox is empty (UI journey did not reach submit)',
		);
		return;
	}
	const ownerMail = files
		.map((name) => ({
			name,
			text: fs.readFileSync(path.join(mailDir, name), 'utf8'),
		}))
		.find((entry) => entry.text.includes(OWNER_A.email));
	record(
		'mail.eml-present',
		ownerMail ? 'PASS' : 'FAIL',
		`${files.length} .eml file(s); owner mail: ${ownerMail?.name ?? 'missing'}`,
	);
	if (!ownerMail) {
		return;
	}
	const link = ownerMail.text.match(
		new RegExp(`https?://[^\\s"'<>]+/reports/${reportIdA}`),
	)?.[0];
	record(
		'mail.link-shape',
		link ? 'PASS' : 'FAIL',
		link ? `link found: ${link}` : 'no /reports/:id link in the owner .eml',
	);
	if (!link) {
		return;
	}
	const page = await openPage(cdp, publicContextId);
	try {
		await navigate(cdp, page, link);
		await sleep(1500);
		const url = await currentUrl(cdp, page);
		const landedOnSignIn = /\/sign-in/i.test(url);
		record(
			'mail.link-signedout-redirect',
			landedOnSignIn ? 'PASS' : 'PENDING',
			landedOnSignIn ?
				`signed-out mail link redirected to ${url}`
			:	`landed on ${url} — signed-out /reports/:id guard needs final UI`,
		);
		await screenshot(cdp, page, '60-mail-link-landing', artifactsDir);
		if (!landedOnSignIn) {
			return;
		}
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['email', 'text'],
				match: ['email', 'メール'],
			},
			OWNER_A.email,
			'sign-in email (from mail link)',
		);
		await fillField(
			cdp,
			page,
			{
				kinds: ['input'],
				types: ['password'],
				match: ['password', 'パスワード'],
			},
			OWNER_A.password,
			'sign-in password (from mail link)',
		);
		await clickElement(
			cdp,
			page,
			{
				kinds: ['button', 'link'],
				inForm: true,
				match: ['ログイン|サインイン|sign.?in|log.?in|送信'],
			},
			'sign-in submit (from mail link)',
		);
		await pollUntil(
			'mail link lands on report',
			async () =>
				new URL(await currentUrl(cdp, page)).pathname
					=== `/reports/${reportIdA}`
				&& (await bodyText(cdp, page)).includes(
					OWNER_A.profile.businessName,
				),
			15_000,
			300,
		);
		const finalText = await bodyText(cdp, page);
		record(
			'mail.link-signin-then-report',
			finalText.includes(OWNER_A.profile.businessName) ? 'PASS' : 'FAIL',
			`landed on the report; business name visible: ${finalText.includes(OWNER_A.profile.businessName)}`,
		);
	} catch (error) {
		await screenshot(cdp, page, '61-mail-link-failure', artifactsDir).catch(
			() => {},
		);
		record(
			'mail.link-signin-then-report',
			error.pending ? 'PENDING' : 'FAIL',
			error.message,
		);
	} finally {
		await page.close();
	}
}

// ---------------------------------------------------------------------------
// Globals shared by phases
// ---------------------------------------------------------------------------

let ownerJar = null;
let staffJar = null;
let seedReportIdA = null;
let seedReportIdB = null;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printHelp() {
	console.log(`tests/browser-journey.mjs — real-browser acceptance harness

Usage:
  node tests/browser-journey.mjs [--smoke] [--headed] [--keep] [--clean] [--strict] [--base-url=URL]

  (no flags)   full contract journey: spawns a hermetic built server
               (npm run build required), seeds synthetic data via the API,
               then drives /signup, /sign-in?next=, /interview, /reports/:id,
               /staff and the local .eml mail link in a real browser.
  --smoke      baseline homepage + API reachability only (works today).
  --headed     show the browser window (pair with the MANUAL UI CHECKLIST
               at the top of this file).
  --keep       keep the browser profile, downloads and server data.
  --clean      delete previous tests/.data runs first.
  --strict     exit non-zero when checks are PENDING (for CI after UIs land).
  --base-url=  drive an already-running server instead of spawning one
               (mail .eml checks become PENDING: the data dir is unknown).

Artifacts land in tests/.data/run-<id>/ (gitignored): browser profile,
downloads, screenshots, last-run.json. Nothing outside tests/.data is
written; the shared .output build is only read, never rebuilt here.`);
}

async function main() {
	if (OPTIONS.help) {
		printHelp();
		return 0;
	}
	if (OPTIONS.clean) {
		// Best effort: a crashed earlier run can leave Edge handles open; a
		// locked dir never fails this run.
		try {
			fs.rmSync(DATA_ROOT, {
				recursive: true,
				force: true,
				maxRetries: 2,
			});
		} catch (error) {
			console.log(
				`[harness] note: --clean could not remove ${DATA_ROOT} (${error.code ?? error.message}); continuing with a fresh run dir`,
			);
		}
	}
	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
	fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
	fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });

	if (!OPTIONS.baseUrl) {
		if (!fs.existsSync(serverEntry)) {
			console.error(
				`missing ${serverEntry} — run \`npm run build\` first (the harness never rebuilds the shared .output). Or pass --base-url=http://localhost:3000 to use a running server.`,
			);
			return 1;
		}
	} else {
		console.log(
			`[harness] BASE_URL mode against ${OPTIONS.baseUrl} (mail .eml checks will be PENDING)`,
		);
	}

	const browser = await launchBrowser();
	const { cdp } = browser;
	console.log(
		`[harness] browser: ${path.basename(browser.executable)} ${browser.version.Browser ?? ''} (cdp :${browser.cdpPort}${OPTIONS.headed ? ', headed' : ', headless'})`,
	);

	const server = OPTIONS.baseUrl ? null : startServer();
	let baseUrl = OPTIONS.baseUrl ?? null;
	const contexts = {};
	try {
		if (server) {
			const entry = await server('journey', '1000');
			baseUrl = entry.baseUrl;
			console.log(
				`[harness] server: ${baseUrl} (data: ${SERVER_DATA_DIR})`,
			);
		}

		for (const name of ['owner', 'staff', 'public']) {
			const { browserContextId } = await cdp.send(
				'Target.createBrowserContext',
				{
					disposeOnDetach: false,
				},
			);
			contexts[name] = browserContextId;
			await cdp.send('Browser.setDownloadBehavior', {
				behavior: 'allow',
				downloadPath: DOWNLOADS_DIR,
				eventsEnabled: true,
				browserContextId,
			});
		}
		// Browser-wide default too: some Edge builds ignore the
		// context-scoped variant, which would send downloads to the
		// profile's own Default folder instead of tests/.data.
		await cdp.send('Browser.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: DOWNLOADS_DIR,
			eventsEnabled: true,
		});

		// --- smoke: always run (baseline homepage) ---
		await runSmokeChecks(cdp, contexts.public, baseUrl, ARTIFACTS_DIR);
		await runLocaleSwitchCheck(cdp, baseUrl, ARTIFACTS_DIR);

		if (OPTIONS.smoke) {
			return finalize(0);
		}

		// --- route probe: which agreed routes are implemented yet? ---
		const probe = {};
		for (const route of [
			'/signup',
			'/sign-in',
			'/interview',
			'/staff',
			'/voice',
		]) {
			probe[route] = await probeRoute(baseUrl, route);
			if (probe[route] === 404 || probe[route] === 0) {
				record(
					`routes.${route}`,
					'PENDING',
					`HTTP ${probe[route]} — route not in the tree yet`,
				);
			} else {
				record(`routes.${route}`, 'PASS', `HTTP ${probe[route]}`);
			}
		}

		// --- seed via API so authenticated UIs can be checked without UI signup ---
		const seedA = await seedOwnerJourney(baseUrl, OWNER_A, TRANSCRIPT_A);
		seedReportIdA = seedA.reportId;
		const seedB = await seedOwnerJourney(baseUrl, OWNER_B, TRANSCRIPT_B);
		seedReportIdB = seedB.reportId;
		ownerJar = seedA.jar;
		console.log(
			`[harness] seeded: report A ${seedReportIdA} (ready), report B ${seedReportIdB} (ready)`,
		);

		const staffLogin = await api(baseUrl, 'POST', '/api/auth/login', {
			body: { email: STAFF.email, password: STAFF.password },
		});
		if (staffLogin.status !== 200) {
			throw new Error(`staff login failed: HTTP ${staffLogin.status}`);
		}
		staffJar = newCookieJar();
		staffJar.map.set(
			'session',
			staffLogin.setCookies[0].split(';')[0].split('=')[1],
		);

		// Inject API-created sessions into the browser contexts (HttpOnly
		// cookies can only be set over CDP, never from page JS). Edge 158 has
		// no Storage.setCookie, so set it via Network.setCookie on a short-
		// lived page inside each context.
		for (const [name, jar] of [
			['owner', ownerJar],
			['staff', staffJar],
		]) {
			const setter = await openPage(cdp, contexts[name]);
			try {
				await cdp.send(
					'Network.setCookie',
					{
						name: 'session',
						value: jar.map.get('session'),
						url: baseUrl,
						path: '/',
						httpOnly: true,
						sameSite: 'Lax',
						secure: false,
					},
					setter.sessionId,
				);
			} finally {
				await setter.close();
			}
		}

		// --- UI journey per contract route (PENDING while UIs are in flight) ---
		if (probe['/signup'] !== 404 && probe['/signup'] !== 0) {
			// Throwaway context: UI signup establishes a session that must not
			// leak into the later signed-out checks (sign-in, mail link).
			const { browserContextId: signupContext } = await cdp.send(
				'Target.createBrowserContext',
				{ disposeOnDetach: false },
			);
			try {
				await runSignupUiCheck(
					cdp,
					signupContext,
					baseUrl,
					ARTIFACTS_DIR,
				);
				await runInterviewUiChecks(
					cdp,
					signupContext,
					baseUrl,
					ARTIFACTS_DIR,
				);
			} finally {
				await cdp
					.send('Target.disposeBrowserContext', {
						browserContextId: signupContext,
					})
					.catch(() => {});
			}
		}

		if (probe['/sign-in'] !== 404 && probe['/sign-in'] !== 0) {
			await runSignInChecks(
				cdp,
				contexts.public,
				baseUrl,
				seedReportIdA,
				ARTIFACTS_DIR,
			);
		}
		const reportsProbe = await probeRoute(
			baseUrl,
			`/reports/${seedReportIdA}`,
		);
		if (reportsProbe !== 404 && reportsProbe !== 0) {
			await runReportUiChecks(
				cdp,
				contexts.owner,
				baseUrl,
				seedReportIdA,
				ARTIFACTS_DIR,
				'owner',
			);
		} else {
			record(
				'routes./reports/:id',
				'PENDING',
				'HTTP 404 — report page not in the tree yet',
			);
		}
		if (probe['/staff'] !== 404 && probe['/staff'] !== 0) {
			await runStaffChecks(
				cdp,
				contexts.staff,
				baseUrl,
				seedReportIdA,
				seedReportIdB,
				ARTIFACTS_DIR,
			);
		}
		if (probe['/voice'] !== 404 && probe['/voice'] !== 0) {
			await runVoicePageChecks(
				cdp,
				contexts.owner,
				baseUrl,
				ARTIFACTS_DIR,
				'owner',
			);
			await runVoicePageChecks(
				cdp,
				contexts.staff,
				baseUrl,
				ARTIFACTS_DIR,
				'staff',
			);
		} else {
			record(
				'routes./voice',
				'PENDING',
				'HTTP 404 — voice page not in the tree yet',
			);
		}
		await runWallAndPersistenceChecks(
			cdp,
			contexts.owner,
			contexts.staff,
			baseUrl,
			ARTIFACTS_DIR,
		);
		const { browserContextId: mailContext } = await cdp.send(
			'Target.createBrowserContext',
			{},
		);
		await runMailChecks(
			cdp,
			mailContext,
			baseUrl,
			seedReportIdA,
			ARTIFACTS_DIR,
		);

		return finalize(0);
	} catch (error) {
		console.error(`[harness] fatal: ${error.message}`);
		try {
			const page = await openPage(cdp, contexts.public);
			await screenshot(cdp, page, '99-fatal', ARTIFACTS_DIR).catch(
				() => {},
			);
			await page.close();
		} catch {
			// best effort
		}
		return finalize(1);
	} finally {
		for (const entry of server?.running.splice(0) ?? []) {
			await entry.close().catch(() => {});
		}
		browser.kill();
		await sleep(1000);
		cdp.close();
		if (!OPTIONS.keep && !OPTIONS.smoke) {
			// Profiles are disposable; keep artifacts + downloads + server data
			// for inspection either way. Edge keeps file handles briefly after
			// taskkill, so retry for a few seconds and never fail the run.
			await pollUntil(
				'browser profile removal',
				async () => {
					try {
						fs.rmSync(PROFILE_DIR, {
							recursive: true,
							force: true,
							maxRetries: 3,
							retryDelay: 300,
						});
						return true;
					} catch {
						return false;
					}
				},
				10_000,
				500,
			).catch(() => {
				console.log(
					`[harness] note: kept ${PROFILE_DIR} (browser still held it)`,
				);
			});
		}
	}

	function finalize(defaultCode) {
		const counts = { PASS: 0, PENDING: 0, FAIL: 0 };
		for (const entry of results) {
			counts[entry.status]++;
		}
		const failed = counts.FAIL > 0;
		const pendingBlocked = OPTIONS.strict && counts.PENDING > 0;
		console.log(
			`--- summary: ${counts.PASS} passed, ${counts.PENDING} pending, ${counts.FAIL} failed (artifacts: ${ARTIFACTS_DIR})`,
		);
		if (counts.PENDING > 0) {
			console.log(
				`--- pending checks need final UI: ${results
					.filter((r) => r.status === 'PENDING')
					.map((r) => r.id)
					.join(', ')}`,
			);
		}
		fs.writeFileSync(
			path.join(RUN_ROOT, 'last-run.json'),
			`${JSON.stringify(
				{
					runId: RUN_ID,
					mode: OPTIONS.smoke ? 'smoke' : 'full',
					baseUrl,
					browser: {
						executable: browser.executable,
						version: browser.version.Browser,
					},
					results,
					counts,
				},
				null,
				2,
			)}\n`,
		);
		return failed || pendingBlocked ? 1 : defaultCode;
	}
}

process.exitCode = await main();
