// Launch check: `npm start` (scripts/start.mjs) binds the built server to the
// loopback interface by default — cross-platform, no extra dependencies. The
// server reports its bound address on stdout; loopback must serve, and any
// non-loopback local address must refuse connections, proving the default is
// local-only. An operator who explicitly sets NITRO_HOST/HOST keeps full
// control (the smoke harness itself does exactly that).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { freePort, repoRoot } from './helpers/server';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const wrapperEntry = path.join(repoRoot, 'scripts', 'start.mjs');

test('npm start binds the loopback interface by default', async () => {
	assert.ok(
		existsSync(wrapperEntry),
		'the launch wrapper scripts/start.mjs is checked in',
	);
	assert.ok(
		existsSync(path.join(repoRoot, '.output', 'server', 'index.mjs')),
		'run `npm run build` first (npm test does)',
	);

	const port = await freePort();
	const dataDir = mkdtempSync(path.join(repoRoot, '.data', 'binding-'));
	const childEnv = { ...process.env };
	// The launch check must prove the DEFAULT binding: no host env at all.
	delete childEnv.HOST;
	delete childEnv.NITRO_HOST;
	childEnv.NITRO_PORT = String(port);
	childEnv.NUXT_DATA_DIR = dataDir;

	const child = spawn(process.execPath, [wrapperEntry], {
		cwd: repoRoot,
		env: childEnv,
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	});
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	try {
		const stdout = await new Promise<string>((resolve, reject) => {
			let text = '';
			child.stdout?.on('data', (chunk: Buffer) => {
				text += chunk.toString();
				if (text.includes('Listening on ')) {
					resolve(text);
				}
			});
			child.once('exit', (code) =>
				reject(new Error(`server exited early (${code}): ${text}${stderr}`)),
			);
			setTimeout(
				() => reject(new Error(`timeout waiting for the listener: ${text}${stderr}`)),
				60_000,
			).unref();
		});

		// The server reports its bound loopback address.
		const line =
			stdout
				.split(/\r?\n/)
				.find((entry) => entry.includes('Listening on ')) ?? '';
		assert.match(line, /Listening on http:\/\/127\.0\.0\.1:\d+/);

		// Loopback serves.
		const response = await fetch(`http://127.0.0.1:${port}/`);
		assert.ok(response.status < 500);
		await response.arrayBuffer();

		// A non-loopback local address (when the machine has one) refuses
		// connections: the server is not bound to 0.0.0.0.
		const external = externalIPv4Address();
		if (external) {
			assert.equal(
				await canConnect(external, port),
				false,
				'the server must not listen on a non-loopback interface',
			);
		}
	} finally {
		child.kill();
		await new Promise<void>((resolve) => child.once('exit', () => resolve()));
		rmSync(dataDir, { recursive: true, force: true });
	}
});

function externalIPv4Address(): string | null {
	for (const interfaces of Object.values(os.networkInterfaces())) {
		for (const entry of interfaces ?? []) {
			if (entry.family === 'IPv4' && !entry.internal) {
				return entry.address;
			}
		}
	}
	return null;
}

function canConnect(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}
