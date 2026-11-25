// Shared helpers for the report test files: spin up the built Nitro server on
// an isolated localhost port (same pattern as tests/api-journey.test.mjs).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(testsDir, '..');
export const serverEntry = path.join(
	repoRoot,
	'.output',
	'server',
	'index.mjs',
);

export function assertBuilt() {
	if (!fs.existsSync(serverEntry)) {
		throw new Error(
			`${serverEntry} is missing — run \`npm run build\` first`,
		);
	}
}

export function freePort() {
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

export function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function newCookieJar() {
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

export async function request(baseUrl, method, pathName, options = {}) {
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
		setCookies: response.headers.getSetCookie(),
		text,
		json,
	};
}

export function expectStatus(step, response, status) {
	if (response.status !== status) {
		throw new Error(
			`${step}: expected HTTP ${status}, got ${response.status} (${response.text.slice(0, 300)})`,
		);
	}
}

export function expectErrorCode(step, response, code) {
	if (response.json?.data?.error !== code) {
		throw new Error(
			`${step}: expected data.error "${code}", got ${response.text.slice(0, 300)}`,
		);
	}
}

export async function pollUntil(
	label,
	fn,
	timeoutMs = 20000,
	intervalMs = 300,
) {
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

export async function startServer(label, pollMs) {
	const port = await freePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const running = [];
	const child = spawn(process.execPath, [serverEntry], {
		cwd: repoRoot,
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: path.join(
				repoRoot,
				'.data',
				'test',
				`report-${process.pid}`,
			),
			PUBLIC_BASE_URL: baseUrl,
			STAFF_EMAILS: 'staff@example.test',
			STAFF_PASSWORD: 'test-staff-password-1234',
			WORKER_POLL_MS: pollMs,
		},
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	running.push(child);
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
			running.splice(0);
		},
	};
}
