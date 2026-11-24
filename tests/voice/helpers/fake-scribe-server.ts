// Loopback WebSocket server for the real dialer (native client → ws server),
// bound to 127.0.0.1 only. Records every handshake (path, query, headers) and
// hands accepted sockets to the test. No external network is touched. `ws` is
// loaded through createRequire because the repo does not ship its type
// declarations; the used surface is mirrored by local structural types.
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import http from 'node:http';

type WsClientLike = {
	on(event: 'message', listener: (data: Buffer) => void): void;
	on(event: 'close', listener: () => void): void;
	send(data: string | Buffer): void;
	close(code?: number, reason?: string): void;
};

type WsServerLike = {
	handleUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		callback: (client: WsClientLike) => void,
	): void;
	close(): void;
};

export type HandshakeRecord = {
	url: string;
	headers: Record<string, string | string[] | undefined>;
};

export type FakeScribeServerMode = 'serve' | 'redirect' | 'hang';

export type FakeScribeServer = {
	port: number;
	url: string;
	handshakes: HandshakeRecord[];
	/** Accepted provider-side sockets, in connection order. */
	clients: WsClientLike[];
	lastClient(): WsClientLike | null;
	close(): Promise<void>;
};

type WebSocketServerConstructor = new (options: { noServer: true }) => WsServerLike;

const { WebSocketServer } = createRequire(import.meta.url)('ws') as {
	WebSocketServer: WebSocketServerConstructor;
};

export async function startFakeScribeServer(options: {
	mode?: FakeScribeServerMode;
	onConnection?: (client: WsClientLike) => void;
} = {}): Promise<FakeScribeServer> {
	const mode = options.mode ?? 'serve';
	const server = http.createServer(() => {
		// Plain HTTP requests are never expected on this fixture.
	});
	const wss = new WebSocketServer({ noServer: true });
	const handshakes: HandshakeRecord[] = [];
	const clients: WsClientLike[] = [];
	// Raw TCP sockets are tracked so teardown can destroy them: a connection
	// held mid-upgrade (hang mode) is not "idle", so closeAllConnections()
	// would leave it open and server.close() would never settle.
	const rawSockets = new Set<Duplex>();
	server.on('connection', (socket: Duplex) => {
		rawSockets.add(socket);
		socket.on('close', () => {
			rawSockets.delete(socket);
		});
	});
	server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		handshakes.push({ url: request.url ?? '', headers: request.headers });
		if (mode === 'redirect') {
			socket.write(
				'HTTP/1.1 302 Found\r\n'
				+ 'Location: wss://not-the-provider.example/steal\r\n'
				+ 'Connection: close\r\n'
				+ 'Content-Length: 0\r\n'
				+ '\r\n',
			);
			socket.destroy();
			return;
		}
		if (mode === 'hang') {
			// Never complete the handshake: the client's open timeout must win.
			return;
		}
		wss.handleUpgrade(request, socket, head, (client) => {
			clients.push(client);
			if (options.onConnection) {
				options.onConnection(client);
			} else if (mode === 'serve') {
				// Default serve mode confirms the start like the real provider.
				client.send(JSON.stringify({
					message_type: 'session_started',
					session_id: 'srv-session-default',
					config: { enable_logging: false, commit_strategy: 'manual' },
				}));
			}
		});
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : 0;
	return {
		port,
		url: `ws://127.0.0.1:${port}/v1/speech-to-text/realtime`,
		handshakes,
		clients,
		lastClient: () => clients[clients.length - 1] ?? null,
		close: () => {
			wss.close();
			// Destroy every raw socket: mid-upgrade connections are not idle,
			// so closing them explicitly is the only way server.close() settles.
			for (const socket of rawSockets) {
				socket.destroy();
			}
			rawSockets.clear();
			server.closeAllConnections();
			return new Promise((resolve) => {
				server.close(() => resolve());
			});
		},
	};
}

/** Collect the JSON frames a fake provider socket receives from the relay. */
export function frameCollector(client: WsClientLike): { frames: unknown[]; waitForClose(): Promise<void> } {
	const frames: unknown[] = [];
	const closed = new Promise<void>((resolve) => {
		client.on('close', resolve);
	});
	client.on('message', (data) => {
		try {
			frames.push(JSON.parse(data.toString()));
		} catch {
			frames.push(data.toString());
		}
	});
	return { frames, waitForClose: () => closed };
}
