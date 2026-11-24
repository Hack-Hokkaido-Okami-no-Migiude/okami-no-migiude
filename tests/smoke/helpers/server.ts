// Smoke harness: boots the built Nitro server from `.output/server/index.mjs`
// (run `npm run build` first) on a free local port with a repo-local ignored
// data directory, plus small fetch helpers. Never touches a real `.data`
// directory and never calls an external network — live runs use the in-test
// stub from `p0-live.test.ts`.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
);
const serverEntry = path.join(repoRoot, '.output', 'server', 'index.mjs');

/** Loopback-only live provider configuration for the local stub. */
export type LiveConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
};

export type SmokeServer = {
	port: number;
	dataDir: string;
	stop: () => Promise<void>;
};

export async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address && typeof address === 'object') {
				probe.close(() => resolve(address.port));
				return;
			}
			probe.close();
			reject(new Error('could not allocate a free port'));
		});
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

/**
 * Start the built server. `dataDir` reopens an existing store (restart
 * durability checks); a fresh temp directory is created when omitted.
 */
export async function startSmokeServer(
	options: {
		dataDir?: string;
		live?: LiveConfig;
		audio?: { baseUrl: string; apiKey: string };
	} = {},
): Promise<SmokeServer> {
	if (!existsSync(serverEntry)) {
		throw new Error(
			`server build missing at ${serverEntry} — run \`npm run build\` first`,
		);
	}
	const port = await freePort();
	mkdirSync(path.join(repoRoot, '.data'), { recursive: true });
	const dataDir =
		options.dataDir ?? mkdtempSync(path.join(repoRoot, '.data', 'smoke-'));
	const child = spawn(
		process.execPath,
		[serverEntry],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				PORT: String(port),
				HOST: '127.0.0.1',
				NUXT_DATA_DIR: dataDir,
				// Live config is opt-in per test server; empty strings mean
				// "unconfigured" for the provider factory.
				NUXT_LLM_BASE_URL: options.live?.baseUrl ?? '',
				NUXT_LLM_API_KEY: options.live?.apiKey ?? '',
				NUXT_LLM_MODEL: options.live?.model ?? '',
				// Recorded-upload provider config is opt-in per test server too.
				NUXT_ELEVENLABS_BASE_URL: options.audio?.baseUrl ?? '',
				NUXT_ELEVENLABS_API_KEY: options.audio?.apiKey ?? '',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		},
	);
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const base = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const response = await fetch(base);
			if (response.status < 500) {
				break;
			}
		} catch {
			// Not listening yet.
		}
		if (Date.now() > deadline) {
			killProcessTree(child.pid ?? 0);
			throw new Error(
				`server did not become ready on port ${port}\n${stderr.slice(-4000)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	let stopped = false;
	return {
		port,
		dataDir,
		stop: async () => {
			if (stopped || child.exitCode !== null || child.signalCode !== null) {
				stopped = true;
				return;
			}
			stopped = true;
			killProcessTree(child.pid ?? 0);
			// taskkill is asynchronous on Windows; wait for the exit event so a
			// restart on the same port/data directory cannot race the shutdown.
			await new Promise<void>((resolve) => {
				child.once('exit', () => resolve());
				setTimeout(resolve, 5000);
			});
		},
	};
}

export type ApiResponse = {
	status: number;
	headers: Headers;
	body: unknown;
	text: string;
};

/** Fetch one API call; non-JSON bodies (markdown) surface through `text`. */
export async function call(
	port: number,
	method: string,
	urlPath: string,
	body?: unknown,
): Promise<ApiResponse> {
	const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method,
		headers:
			body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		// Non-JSON body (e.g. markdown download).
	}
	return { status: response.status, headers: response.headers, body: parsed, text };
}

/** The shared error envelope, or an empty record for non-error bodies. */
export function errorBody(body: unknown): {
	code?: unknown;
	message?: unknown;
	currentRev?: unknown;
} {
	const record = body as { error?: Record<string, unknown> };
	return record?.error ?? {};
}

/** The current persisted revision of the demo session (robust test plumbing). */
export async function currentRev(port: number, sessionPath: string): Promise<number> {
	const response = await call(port, 'GET', sessionPath);
	if (response.status !== 200) {
		throw new Error(`session GET failed: ${response.text}`);
	}
	return (response.body as { rev?: number }).rev ?? 0;
}

/** Remove a smoke data directory after its server has stopped. */
export function removeDataDir(dataDir: string): void {
	rmSync(dataDir, { recursive: true, force: true });
}
