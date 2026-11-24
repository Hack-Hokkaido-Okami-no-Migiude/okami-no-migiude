import type { VoiceIO } from './-voiceInterview';

const SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 1024;
const MAX_SOCKET_QUEUE = 32 * 1024;
const MAX_QUESTION_BYTES = 1_000_000;

export function encodePcm16(samples: Float32Array): ArrayBuffer {
	const bytes = new ArrayBuffer(samples.length * 2);
	const view = new DataView(bytes);
	for (let index = 0; index < samples.length; index++) {
		const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
		view.setInt16(
			index * 2,
			Math.round(sample * (sample < 0 ? 32_768 : 32_767)),
			true,
		);
	}
	return bytes;
}

export function browserSupportsVoice() {
	return (
		window.isSecureContext
		&& !!navigator.mediaDevices?.getUserMedia
		&& typeof AudioContext === 'function'
		&& typeof WebSocket === 'function'
		&& typeof AudioContext.prototype.createScriptProcessor === 'function'
		&& typeof crypto.randomUUID === 'function'
		&& typeof AbortSignal.any === 'function'
		&& typeof AbortSignal.timeout === 'function'
	);
}

const openMic: VoiceIO['openMic'] = async (send, signal) => {
	signal.throwIfAborted();
	const stream = await navigator.mediaDevices.getUserMedia({
		video: false,
		audio: {
			channelCount: { ideal: 1 },
			echoCancellation: true,
			noiseSuppression: true,
		},
	});
	const tracks = stream.getTracks();
	let context: AudioContext | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	let processor: ScriptProcessorNode | undefined;
	let closed = false;
	let enabled = false;
	const setEnabled = (value: boolean) => {
		enabled = value && !closed;
		for (const track of tracks) {
			track.enabled = enabled;
		}
	};
	const close = () => {
		if (closed) {
			return;
		}
		closed = true;
		signal.removeEventListener('abort', close);
		setEnabled(false);
		for (const track of tracks) {
			track.stop();
		}
		if (processor) {
			processor.onaudioprocess = null;
			processor.disconnect();
		}
		source?.disconnect();
		if (context) {
			void context.close().catch(() => {});
		}
	};
	try {
		// getUserMedia itself is not abortable. A late stream still gets stopped.
		setEnabled(false);
		signal.throwIfAborted();
		signal.addEventListener('abort', close, { once: true });
		context = new AudioContext({ sampleRate: SAMPLE_RATE });
		if (context.sampleRate !== SAMPLE_RATE) {
			throw new Error('Unsupported capture sample rate');
		}
		source = context.createMediaStreamSource(stream);
		processor = context.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
		processor.onaudioprocess = (event) => {
			// The output stays silent: the microphone never loops back to the speakers.
			if (enabled) {
				send(encodePcm16(event.inputBuffer.getChannelData(0)));
			}
		};
		source.connect(processor);
		processor.connect(context.destination);
		await context.resume();
		signal.throwIfAborted();
		return { close, setEnabled };
	} catch (error) {
		close();
		throw error;
	}
};

const sameOriginRequest = {
	credentials: 'same-origin',
	mode: 'same-origin',
	redirect: 'error',
	cache: 'no-store',
} as const;

async function loadQuestion(url: string, signal: AbortSignal) {
	const response = await fetch(url, { ...sameOriginRequest, signal });
	const type = response.headers.get('content-type') ?? '';
	if (!response.ok || !type.startsWith('audio/') || !response.body) {
		await response.body?.cancel();
		throw new Error('Question audio unavailable');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			total += value.byteLength;
			if (total > MAX_QUESTION_BYTES) {
				throw new Error('Question audio too large');
			}
			chunks.push(new Uint8Array(value));
		}
		return new Blob(chunks, { type });
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

const play: VoiceIO['play'] = async (url, sessionSignal) => {
	const signal = AbortSignal.any([
		sessionSignal,
		AbortSignal.timeout(30_000),
	]);
	const blob = await loadQuestion(url, signal);
	signal.throwIfAborted();
	const audio = new Audio();
	const objectUrl = URL.createObjectURL(blob);
	try {
		await new Promise<void>((resolve, reject) => {
			const ended = () => settle();
			const failed = () =>
				settle(new Error('Question audio did not play'));
			const settle = (error?: Error) => {
				signal.removeEventListener('abort', failed);
				audio.onended = null;
				audio.onerror = null;
				audio.pause();
				audio.removeAttribute('src');
				audio.load();
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			signal.addEventListener('abort', failed, { once: true });
			audio.onended = ended;
			audio.onerror = failed;
			audio.src = objectUrl;
			void audio.play().catch(failed);
		});
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
};

export function browserVoiceIO(
	csrfHeaders: () => HeadersInit | undefined,
): VoiceIO {
	return {
		origin: () => window.location.origin,
		newId: () => crypto.randomUUID(),
		async post(path, body) {
			const headers = new Headers(csrfHeaders());
			headers.set('Content-Type', 'application/json');
			headers.set('Idempotency-Key', crypto.randomUUID());
			const stopping = path.endsWith('/stop');
			const response = await fetch(path, {
				...sameOriginRequest,
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				keepalive: stopping,
				signal: AbortSignal.timeout(stopping ? 10_000 : 20_000),
			});
			if (!response.ok) {
				throw new Error('Voice request rejected');
			}
			return response.json() as Promise<unknown>;
		},
		connect(url, handlers) {
			const socket = new WebSocket(url);
			socket.onmessage = (event) => handlers.message(event.data);
			socket.onerror = handlers.disconnected;
			socket.onclose = handlers.disconnected;
			return {
				send(data) {
					if (
						socket.readyState !== WebSocket.OPEN
						|| socket.bufferedAmount > MAX_SOCKET_QUEUE
					) {
						throw new Error('Voice relay unavailable');
					}
					if (typeof data === 'string') {
						socket.send(data);
					} else {
						socket.send(data);
					}
				},
				close() {
					socket.onmessage = socket.onerror = socket.onclose = null;
					socket.close();
				},
			};
		},
		openMic,
		play,
	};
}
