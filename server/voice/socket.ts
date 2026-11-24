// The transport seam for the realtime provider socket. Production dials with
// the Node runtime's native WHATWG WebSocket client (no dependency), passing
// the API key as the documented handshake header so the key never appears in
// a URL. Tests inject a loopback server or a fake socket through the same
// interface. Binary frames are ignored and oversized frames are dropped.
import { MAX_INBOUND_FRAME_CHARS } from './config';
import { StageError } from '../../shared/p0/stages';

/**
 * Minimal socket surface the scribe adapter needs. Deliberately narrow so a
 * test double is trivial and the production dialer stays swappable.
 */
export type VoiceSocketLike = {
	send(text: string): void;
	close(code: number, reason: string): void;
	onOpen(callback: () => void): void;
	onText(callback: (text: string) => void): void;
	onClose(callback: (code: number) => void): void;
	onError(callback: () => void): void;
	/** True once the dialer has observed a successful handshake. */
	readonly opened: boolean;
};

/**
 * Dial the realtime provider socket with the Node runtime's native WebSocket
 * client. The `headers` constructor option is a Node (undici) extension that
 * is required here: the documented socket authentication is the `xi-api-key`
 * handshake header, which keeps the credential out of the URL entirely. A
 * redirect handshake response fails the connection instead of being followed,
 * so the key and audio are never relayed elsewhere.
 */
export function openNodeWebSocket(
	url: string,
	headers: Record<string, string>,
): VoiceSocketLike {
	if (typeof WebSocket !== 'function') {
		throw new StageError(
			'provider_failed',
			'The server runtime does not provide the WebSocket client required for live voice.',
		);
	}
	let opened = false;
	const openCallbacks: Array<() => void> = [];
	const textCallbacks: Array<(text: string) => void> = [];
	const closeCallbacks: Array<(code: number) => void> = [];
	const errorCallbacks: Array<() => void> = [];
	// The project's lib types describe the DOM constructor (`string | string[]`);
	// the Node (undici) client additionally accepts the non-standard
	// `headers` handshake option, verified against the running runtime.
	type NodeWebSocketConstructor = new (
		url: string,
		options: { headers: Record<string, string> },
	) => WebSocket;
	const NativeWebSocket = WebSocket as unknown as NodeWebSocketConstructor;
	const socket = new NativeWebSocket(url, { headers });
	socket.addEventListener('open', () => {
		opened = true;
		for (const callback of openCallbacks) {
			callback();
		}
	});
	socket.addEventListener('message', (event) => {
		if (typeof event.data !== 'string') {
			// The provider speaks JSON text frames only; ignore anything else.
			return;
		}
		if (event.data.length > MAX_INBOUND_FRAME_CHARS) {
			return;
		}
		for (const callback of textCallbacks) {
			callback(event.data);
		}
	});
	socket.addEventListener('close', (event) => {
		for (const callback of closeCallbacks) {
			callback(event.code);
		}
	});
	socket.addEventListener('error', () => {
		for (const callback of errorCallbacks) {
			callback();
		}
	});
	return {
		get opened() {
			return opened;
		},
		send(text: string): void {
			socket.send(text);
		},
		close(code: number, reason: string): void {
			try {
				socket.close(code, reason.slice(0, 120));
			} catch {
				// Closing an already-dead socket must never throw into the route.
			}
		},
		onOpen(callback: () => void): void {
			openCallbacks.push(callback);
		},
		onText(callback: (text: string) => void): void {
			textCallbacks.push(callback);
		},
		onClose(callback: (code: number) => void): void {
			closeCallbacks.push(callback);
		},
		onError(callback: () => void): void {
			errorCallbacks.push(callback);
		},
	};
}
