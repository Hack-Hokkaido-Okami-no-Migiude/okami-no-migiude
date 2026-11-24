// API test harness: boots the built Nitro server when `.output` exists (the
// normal case during integration — `npm test` builds first), falling back to
// the Nuxt dev server for standalone runs without a build. Either way the
// server runs on a private port with a repo-local ignored data directory,
// waits for readiness, and is torn down after the file's tests finish.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
);
const serverEntry = path.join(repoRoot, '.output', 'server', 'index.mjs');

let child: ChildProcess | null = null;
let dataDirectory: string | null = null;
let baseUrl = '';

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address !== null && typeof address === 'object') {
				probe.close(() => resolve(address.port));
			} else {
				probe.close(() => reject(new Error('No listen address.')));
			}
		});
		probe.on('error', reject);
	});
}

function killProcessTree(pid: number): void {
	if (process.platform === 'win32') {
		spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
			stdio: 'ignore',
		});
		return;
	}
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		// Already gone.
	}
}

/** Loopback-only recorded-upload provider configuration for the local stub. */
export type AudioConfig = {
	baseUrl: string;
	apiKey: string;
};

/** Start the dev server once per test file; returns its base URL. */
export async function startServer(
	options: { audio?: AudioConfig } = {},
): Promise<string> {
	if (baseUrl !== '') {
		return baseUrl;
	}
	mkdirSync(path.join(repoRoot, '.data'), { recursive: true });
	dataDirectory = mkdtempSync(path.join(repoRoot, '.data', 'api-'));
	const port = await freePort();
	// The built server starts in ~1s versus ~30s+ for the dev server and is the
	// artifact `npm test` just built; the dev fallback keeps standalone runs
	// working before a first build (npm needs a shell on Windows).
	const useBuiltServer = existsSync(serverEntry);
	child = spawn(
		useBuiltServer ? process.execPath : 'npm',
		useBuiltServer ?
			[serverEntry]
		:	['run', 'dev', '--', '--port', String(port)],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				PORT: String(port),
				HOST: '127.0.0.1',
				NUXT_DATA_DIR: dataDirectory,
				// Recorded-upload provider config is opt-in per test server; empty
				// strings mean "unconfigured" and never inherit a developer's shell.
				NUXT_ELEVENLABS_BASE_URL: options.audio?.baseUrl ?? '',
				NUXT_ELEVENLABS_API_KEY: options.audio?.apiKey ?? '',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			shell: !useBuiltServer,
		},
	);
	let output = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		output += chunk.toString();
	});
	baseUrl = `http://127.0.0.1:${port}`;
	const startedAt = Date.now();
	for (;;) {
		if (child.exitCode !== null) {
			throw new Error(
				`The Nuxt dev server exited during startup.\n${output.slice(-4000)}`,
			);
		}
		try {
			const response = await fetch(baseUrl);
			if (response.status < 500) {
				return baseUrl;
			}
		} catch {
			// Not listening yet.
		}
		if (Date.now() - startedAt > 180_000) {
			killProcessTree(child.pid ?? 0);
			throw new Error(
				`The dev server never became ready.\n${output.slice(-4000)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/** Kill the dev server tree and remove its data directory. */
export async function stopServer(): Promise<void> {
	if (child?.pid) {
		killProcessTree(child.pid);
		child = null;
	}
	if (dataDirectory) {
		rmSync(dataDirectory, { recursive: true, force: true });
		dataDirectory = null;
	}
	baseUrl = '';
}

/** Convenience fetch: JSON body in, `{status, json}` out. */
export async function call(
	method: string,
	url: string,
	body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let json: unknown = null;
	try {
		json = text.length > 0 ? JSON.parse(text) : null;
	} catch {
		// Non-JSON response body: expose it through `text` instead.
	}
	return { status: response.status, json, text };
}

export function errorBody(
	json: unknown,
): { code: string; message: string; currentRev?: number } {
	const record = json as { error?: { code: string; message: string; currentRev?: number } };
	if (record?.error === undefined) {
		throw new Error(`Expected an error body, got ${JSON.stringify(json)}`);
	}
	return record.error;
}
