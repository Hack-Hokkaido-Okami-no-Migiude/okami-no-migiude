// Local speech-to-text stub used instead of the real ElevenLabs API in tests
// and manual browser verification. Implements just enough of the documented
// batch contract (POST /v1/speech-to-text multipart, DELETE by transcription
// id) to exercise the recorded-upload route end to end. Never contacts the
// network and never holds credentials.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { once } from 'node:events';

/** Shape of the documented `SpeechToTextWordResponseModel` entries we rely on. */
type ScribeWord = {
	text: string;
	type: 'word' | 'spacing' | 'audio_event';
	logprob: number;
	start: number | null;
	end: number | null;
	speaker_id: string | null;
};

/** One observed transcription request, without any audio bytes. */
export type ObservedUpload = {
	fields: Record<string, string>;
	filename: string | null;
	contentType: string | null;
	byteLength: number;
};

export type AudioStubMode =
	// Normal: returns the canned Japanese two-speaker transcription.
	| 'ok'
	// English two-speaker transcription.
	| 'english'
	// No speaker annotations at all.
	| 'anonymous'
	// HTTP 500 with a body that must never surface in error messages.
	| 'server-error'
	// HTTP 200 with a body that is not JSON.
	| 'malformed'
	// HTTP 200 with valid JSON but an empty words list.
	| 'empty'
	// HTTP 307 redirect (POST and DELETE) that must never be followed.
	| 'redirect'
	// HTTP 200 whose body streams past the client's response cap, chunked
	// (no content-length) so only the streaming cap can bound it.
	| 'oversized'
	// Never responds (used with a short client timeout).
	| 'slow';

export type AudioStub = {
	url: string;
	port: number;
	uploads: ObservedUpload[];
	deletions: string[];
	requestCount: () => number;
	setMode: (mode: AudioStubMode) => void;
	close: () => Promise<void>;
};

type Part = {
	name: string;
	filename: string | null;
	contentType: string | null;
	value: Buffer;
};

/** Minimal multipart/form-data parser for the stub's validation needs. */
export function parseMultipart(body: Buffer, contentType: string): Part[] {
	const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
	if (!boundaryMatch) {
		return [];
	}
	const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
	const marker = Buffer.from(boundary);
	const parts: Part[] = [];
	let index = body.indexOf(marker);
	while (index !== -1) {
		const lineEnd = body.indexOf('\r\n', index);
		if (lineEnd === -1) {
			break;
		}
		const start = lineEnd + 2;
		const next = body.indexOf(marker, start);
		if (next === -1) {
			break;
		}
		// A closing part is followed by "--" right after the boundary line.
		const closing = body.slice(next + marker.length, next + marker.length + 2)
			.toString('latin1');
		const raw = body.slice(start, next - 2); // strip trailing \r\n
		const headerEnd = raw.indexOf('\r\n\r\n');
		if (headerEnd !== -1) {
			const headerText = raw.slice(0, headerEnd).toString('utf8');
			const value = raw.slice(headerEnd + 4);
			const disposition = /content-disposition:[^\n]*/i.exec(headerText)?.[0] ?? '';
			const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
			const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
			const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? null;
			parts.push({
				name,
				filename: filename && filename.length > 0 ? filename : null,
				contentType: contentTypeMatch,
				value,
			});
		}
		if (closing.startsWith('--')) {
			break;
		}
		index = body.indexOf(marker, next);
	}
	return parts;
}

const JAPANESE_WORDS: ScribeWord[] = [
	{ text: '受付', type: 'word', logprob: -0.1, start: 0, end: 0.4, speaker_id: 'speaker_0' },
	{ text: 'です', type: 'word', logprob: -0.1, start: 0.4, end: 0.8, speaker_id: 'speaker_0' },
	{ text: '、', type: 'word', logprob: -0.1, start: 0.8, end: 0.95, speaker_id: 'speaker_0' },
	{ text: 'ご予約', type: 'word', logprob: -0.1, start: 0.95, end: 1.6, speaker_id: 'speaker_0' },
	{ text: 'ですね', type: 'word', logprob: -0.1, start: 1.6, end: 2.2, speaker_id: 'speaker_0' },
	{ text: '。', type: 'word', logprob: -0.1, start: 2.2, end: 2.4, speaker_id: 'speaker_0' },
	{ text: '(laughter)', type: 'audio_event', logprob: -0.2, start: 2.5, end: 2.8, speaker_id: null },
	{ text: 'はい', type: 'word', logprob: -0.1, start: 2.9, end: 3.3, speaker_id: 'speaker_1' },
	{ text: '、', type: 'word', logprob: -0.1, start: 3.3, end: 3.4, speaker_id: 'speaker_1' },
	{ text: '先月', type: 'word', logprob: -0.1, start: 3.4, end: 3.9, speaker_id: 'speaker_1' },
	{ text: '予約した', type: 'word', logprob: -0.1, start: 3.9, end: 4.6, speaker_id: 'speaker_1' },
	{ text: '佐藤', type: 'word', logprob: -0.1, start: 4.6, end: 5, speaker_id: 'speaker_1' },
	{ text: 'です', type: 'word', logprob: -0.1, start: 5, end: 5.4, speaker_id: 'speaker_1' },
];

const ENGLISH_WORDS: ScribeWord[] = [
	{ text: 'Good', type: 'word', logprob: -0.1, start: 0, end: 0.3, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', logprob: 0, start: null, end: null, speaker_id: null },
	{ text: 'morning', type: 'word', logprob: -0.1, start: 0.3, end: 0.8, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', logprob: 0, start: null, end: null, speaker_id: null },
	{ text: 'everyone', type: 'word', logprob: -0.1, start: 0.8, end: 1.3, speaker_id: 'speaker_0' },
	{ text: ' ', type: 'spacing', logprob: 0, start: null, end: null, speaker_id: null },
	{ text: 'Morning', type: 'word', logprob: -0.1, start: 1.9, end: 2.3, speaker_id: 'speaker_1' },
	{ text: ' ', type: 'spacing', logprob: 0, start: null, end: null, speaker_id: null },
	{ text: 'Yuki', type: 'word', logprob: -0.1, start: 2.3, end: 2.7, speaker_id: 'speaker_1' },
	{ text: ' ', type: 'spacing', logprob: 0, start: null, end: null, speaker_id: null },
	{ text: 'here', type: 'word', logprob: -0.1, start: 2.7, end: 3.1, speaker_id: 'speaker_1' },
];

function transcription(words: typeof JAPANESE_WORDS) {
	return {
		language_code: 'jpn',
		language_probability: 0.98,
		text: words
			.filter((word) => word.type !== 'spacing')
			.map((word) => word.text)
			.join(''),
		words,
		transcription_id: 'transcription_stub_1',
		audio_duration_secs: 5.4,
	};
}

function responseFor(mode: AudioStubMode): { status: number; body: string; type: string } {
	switch (mode) {
		case 'english':
			return { status: 200, body: JSON.stringify(transcription(ENGLISH_WORDS)), type: 'application/json' };
		case 'anonymous':
			return {
				status: 200,
				body: JSON.stringify(transcription(
					ENGLISH_WORDS.map(({ speaker_id: speaker, ...rest }) => ({ ...rest, speaker_id: null })),
				)),
				type: 'application/json',
			};
		case 'server-error':
			// A payload that must never appear in a surfaced error message.
			return { status: 500, body: '{"secret-provider-detail":"do-not-leak"}', type: 'application/json' };
		case 'malformed':
			return { status: 200, body: '<html>not json</html>', type: 'text/html' };
		case 'empty':
			return { status: 200, body: JSON.stringify({ ...transcription(JAPANESE_WORDS), words: [], text: '' }), type: 'application/json' };
		case 'redirect':
			return { status: 307, body: '', type: 'text/plain' };
		case 'oversized': {
			// Past the documented response cap; ASCII so bytes == characters.
			const filler = 'x'.repeat(5_100_000);
			return { status: 200, body: `{"words":["${filler}"]}`, type: 'application/json' };
		}
		case 'slow':
			return { status: 0, body: '', type: '' }; // handled by the never-resolving branch
		case 'ok':
		default:
			return { status: 200, body: JSON.stringify(transcription(JAPANESE_WORDS)), type: 'application/json' };
	}
}

/** Start the stub on a loopback port (random when omitted). */
export async function startAudioStub(port = 0): Promise<AudioStub> {
	const state = {
		mode: 'ok' as AudioStubMode,
		uploads: [] as ObservedUpload[],
		deletions: [] as string[],
	};

	const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks);
			const url = request.url ?? '';
			if (request.method === 'POST' && url.split('?')[0] === '/v1/speech-to-text') {
				const parts = parseMultipart(body, String(request.headers['content-type'] ?? ''));
				const fields: Record<string, string> = {};
				let file: Part | null = null;
				for (const part of parts) {
					if (part.filename !== null && part.name === 'file') {
						file = part;
					} else {
						fields[part.name] = part.value.toString('utf8');
					}
				}
				state.uploads.push({
					fields,
					filename: file?.filename ?? null,
					contentType: file?.contentType ?? null,
					byteLength: file?.value.byteLength ?? 0,
				});
				// The stub validates the documented contract like the real API would.
				if (!file || fields.model_id !== 'scribe_v3' || fields.diarize !== 'true' || fields.timestamps_granularity !== 'word') {
					response.writeHead(422, { 'content-type': 'application/json' });
					response.end('{"detail":[{"msg":"unsupported request"}]}');
					return;
				}
				if (state.mode === 'slow') {
					// Never respond; the client timeout must fire.
					return;
				}
				if (state.mode === 'redirect') {
					// Redirect to this same endpoint; a compliant client rejects it
					// instead of relaying the upload here a second time.
					response.writeHead(307, { location: url });
					response.end();
					return;
				}
				const planned = responseFor(state.mode);
				response.writeHead(planned.status, { 'content-type': planned.type || 'application/json' });
				response.end(planned.body);
				return;
			}
			const deletion = /^\/v1\/speech-to-text\/([^/]+)$/.exec(url.split('?')[0]);
			if (request.method === 'DELETE' && deletion) {
				const id = decodeURIComponent(deletion[1] ?? '');
				// Recorded before the redirect branch so a redirecting request is
				// itself observed; a followed one would appear a second time.
				state.deletions.push(id);
				if (state.mode === 'redirect') {
					// Same redirect contract as the POST path.
					response.writeHead(307, { location: url });
					response.end();
					return;
				}
				// Only the id the stub issued has a stored transcript; anything else
				// behaves like "nothing retained under that id" (404).
				const status = id === 'transcription_stub_1' ? 200 : 404;
				response.writeHead(status, { 'content-type': 'application/json' });
				response.end(status === 200 ? '{"detail":"Delete completed successfully."}' : '{"detail":"not found"}');
				return;
			}
			response.writeHead(404, { 'content-type': 'application/json' });
			response.end('{"detail":"not found"}');
		});
	});
	server.listen(port, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${address.port}`,
		port: address.port,
		uploads: state.uploads,
		deletions: state.deletions,
		requestCount: () => state.uploads.length + state.deletions.length,
		setMode: (mode: AudioStubMode) => {
			state.mode = mode;
		},
		close: async () => {
			server.close();
			await once(server, 'close');
		},
	};
}
