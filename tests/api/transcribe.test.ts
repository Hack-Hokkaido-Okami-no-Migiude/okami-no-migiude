// Recorded-upload route tests against the built Nitro server with a loopback
// stub standing in for the ElevenLabs batch speech-to-text API: consent and
// scope gates before any outbound call, malformed/oversize/disallowed uploads,
// the unpersisted draft contract (Japanese grouping, diarization, timestamps),
// provider error redaction without fixture fallback, and the CAS-guarded
// reviewed save that marks the transcript source `audio`.
import { type AudioStub, startAudioStub } from './helpers/audio-stub';
import { after, before, test } from 'node:test';
import {
	call,
	errorBody,
	startServer,
	stopServer,
} from './helpers/server';
import type { Session } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

const base = { url: '' };
let stub: AudioStub;
const asSession = (json: unknown): Session => json as Session;

/** A minimal valid 16-bit PCM WAV file (44-byte header + short silence). */
export function wavBytes(seconds = 0.2): Buffer {
	const sampleRate = 8000;
	const samples = Math.round(sampleRate * seconds);
	const dataSize = samples * 2;
	const buffer = Buffer.alloc(44 + dataSize);
	buffer.write('RIFF', 0, 'latin1');
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write('WAVE', 8, 'latin1');
	buffer.write('fmt ', 12, 'latin1');
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36, 'latin1');
	buffer.writeUInt32LE(dataSize, 40);
	return buffer;
}

type UploadOptions = {
	filename?: string;
	bytes?: Buffer;
	consent?: string | null;
	type?: string;
};

async function transcribe(
	sessionPath: string,
	options: UploadOptions = {},
): Promise<{ status: number; json: unknown }> {
	const form = new FormData();
	form.append(
		'file',
		new Blob([options.bytes ?? wavBytes()], { type: options.type ?? 'audio/wav' }),
		options.filename ?? 'interview.wav',
	);
	if (options.consent !== null) {
		form.append('consent', options.consent ?? 'true');
	}
	const response = await fetch(`${base.url}${sessionPath}/transcribe`, {
		method: 'POST',
		body: form,
	});
	return { status: response.status, json: await response.json() };
}

/**
 * The same valid upload, sent as a chunked request without a Content-Length
 * header — the shape the server must reject before buffering anything.
 */
function transcribeWithoutDeclaredLength(
	sessionPath: string,
): Promise<{ status: number; json: unknown }> {
	return new Promise((resolve, reject) => {
		const boundary = '----recorded-lengthless';
		const body = Buffer.concat([
			Buffer.from(
				`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="interview.wav"\r\ncontent-type: audio/wav\r\n\r\n`,
				'utf8',
			),
			wavBytes(),
			Buffer.from(
				`\r\n--${boundary}\r\ncontent-disposition: form-data; name="consent"\r\n\r\ntrue\r\n--${boundary}--\r\n`,
				'utf8',
			),
		]);
		const target = new URL(`${base.url}${sessionPath}/transcribe`);
		const request_ = httpRequest(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname,
				method: 'POST',
				headers: {
					'content-type': `multipart/form-data; boundary=${boundary}`,
					'transfer-encoding': 'chunked',
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					resolve({
						status: response.statusCode ?? 0,
						json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
					});
				});
			},
		);
		request_.on('error', reject);
		request_.end(body);
	});
}

before(async () => {
	stub = await startAudioStub();
	base.url = await startServer({
		audio: { baseUrl: stub.url, apiKey: 'stub-key-local' },
	});
	const client = await call('POST', `${base.url}/api/clients`, { name: 'Audio Client' });
	assert.equal(client.status, 201);
	clientId = (client.json as { id: string }).id;
	const created = await call('POST', `${base.url}/api/clients/${clientId}/sessions`, {
		title: 'Recorded intake',
	});
	assert.equal(created.status, 201);
	sessionId = (created.json as { id: string }).id;
});

after(async () => {
	await stopServer();
	await stub.close();
});

let clientId = '';
let sessionId = '';
const sessionPath = () => `/api/clients/${clientId}/sessions/${sessionId}`;

test('a missing consent acknowledgement is rejected before any provider call', async () => {
	const response = await transcribe(sessionPath(), { consent: null });
	assert.equal(response.status, 422);
	const body = errorBody(response.json);
	assert.equal(body.code, 'consent_required');
	assert.match(body.message, /participants/);
	assert.match(body.message, /United States/);
	assert.match(body.message, /does not keep|does not retain|not keep/);
	assert.equal(stub.requestCount(), 0, 'no outbound request without consent');
});

test('unknown sessions are rejected without contacting the provider', async () => {
	const response = await transcribe('/api/clients/cli_fresh_audio/sessions/ses_missing');
	assert.equal(response.status, 404);
	assert.equal(errorBody(response.json).code, 'not_found');
	assert.equal(stub.requestCount(), 0);
});

test('malformed multipart bodies are rejected as invalid input', async () => {
	const response = await fetch(`${base.url}${sessionPath()}/transcribe`, {
		method: 'POST',
		headers: { 'content-type': 'multipart/form-data' },
		body: 'this is not a multipart body',
	});
	assert.equal(response.status, 400);
	assert.equal(errorBody(await response.json()).code, 'invalid_input');
	assert.equal(stub.requestCount(), 0);
});

test('uploads beyond the documented cap are rejected before the provider', async () => {
	const oversized = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x52);
	const response = await transcribe(sessionPath(), {
		bytes: oversized,
		filename: 'big.wav',
	});
	assert.equal(response.status, 400);
	assert.equal(errorBody(response.json).code, 'invalid_input');
	assert.equal(stub.requestCount(), 0, 'the oversized body never reaches the provider');
});

test('uploads without a declared size are rejected before any body is buffered', async () => {
	const response = await transcribeWithoutDeclaredLength(sessionPath());
	assert.equal(response.status, 400);
	const body = errorBody(response.json);
	assert.equal(body.code, 'invalid_input');
	assert.match(body.message, /Content-Length/u);
	assert.equal(
		stub.requestCount(),
		0,
		'a lengthless upload never reaches the provider',
	);
});

test('files outside the audio allowlist are rejected', async () => {
	const response = await transcribe(sessionPath(), {
		filename: 'notes.txt',
		bytes: Buffer.from('plain text, not audio', 'utf8'),
		type: 'text/plain',
	});
	assert.equal(response.status, 400);
	const message = errorBody(response.json).message;
	assert.match(message, /\.mp3/);
	assert.equal(stub.requestCount(), 0);
});

test('content that does not match its extension is rejected', async () => {
	const response = await transcribe(sessionPath(), {
		filename: 'claiming-mp3.mp3',
		bytes: wavBytes(),
	});
	assert.equal(response.status, 400);
	assert.equal(errorBody(response.json).code, 'invalid_input');
	assert.equal(stub.requestCount(), 0);
});

const EXPECTED_JP_ROWS = [
	{ speaker: 'Speaker 1', text: '受付です、ご予約ですね。', startMs: 0, endMs: 2400 },
	{ speaker: 'Speaker 2', text: 'はい、先月予約した佐藤です', startMs: 2900, endMs: 5400 },
];

test('a Japanese recording returns unpersisted diarized review rows', async () => {
	const response = await transcribe(sessionPath());
	assert.equal(response.status, 200);
	const body = response.json as {
		draft: { source: string; segments: unknown[] };
		languageCode: string | null;
		cleanup: string;
	};
	assert.equal(body.draft.source, 'audio');
	assert.deepEqual(body.draft.segments, EXPECTED_JP_ROWS);
	assert.equal(body.languageCode, 'jpn');
	assert.equal(body.cleanup, 'deleted');
	assert.deepEqual(stub.deletions, ['transcription_stub_1']);

	// Nothing was persisted: same revision, still no transcript.
	const session = asSession((await call('GET', `${base.url}${sessionPath()}`)).json);
	assert.equal(session.rev, 1);
	assert.equal(session.transcript, null);
});

test('the provider sees a generic basename and the documented parameters', () => {
	const observed = stub.uploads.at(-1);
	assert.equal(observed?.filename, 'recording.wav');
	assert.notEqual(observed?.filename, 'interview.wav');
	assert.equal(observed?.fields.model_id, 'scribe_v3');
	assert.equal(observed?.fields.diarize, 'true');
	assert.equal(observed?.fields.timestamps_granularity, 'word');
	assert.equal(observed?.byteLength, wavBytes().byteLength);
});

test('English rows keep exactly the provider spacing', async () => {
	stub.setMode('english');
	const response = await transcribe(sessionPath());
	assert.equal(response.status, 200);
	const body = response.json as { draft: { segments: { speaker: string; text: string }[] } };
	assert.deepEqual(
		body.draft.segments.map((segment) => [segment.speaker, segment.text]),
		[
			['Speaker 1', 'Good morning everyone'],
			['Speaker 2', 'Morning Yuki here'],
		],
	);
});

test('an unattributed transcription produces unattributed rows', async () => {
	stub.setMode('anonymous');
	const response = await transcribe(sessionPath());
	assert.equal(response.status, 200);
	const body = response.json as { draft: { segments: { speaker: string | null; text: string }[] } };
	assert.equal(body.draft.segments.length, 1);
	assert.equal(body.draft.segments[0]?.speaker, null);
});

test('provider failures are redacted, never fall back to fixtures, and change nothing', async () => {
	stub.setMode('server-error');
	const response = await transcribe(sessionPath());
	assert.equal(response.status, 502);
	const body = errorBody(response.json);
	assert.equal(body.code, 'provider_failed');
	assert.equal(body.message.includes('secret-provider-detail'), false);
	assert.equal((response.json as Record<string, unknown>).draft, undefined);
	const session = asSession((await call('GET', `${base.url}${sessionPath()}`)).json);
	assert.equal(session.transcript, null);
	assert.equal(session.rev, 1);

	stub.setMode('malformed');
	const malformed = await transcribe(sessionPath());
	assert.equal(malformed.status, 502);
	assert.equal(errorBody(malformed.json).code, 'invalid_model_output');

	stub.setMode('empty');
	const empty = await transcribe(sessionPath());
	assert.equal(empty.status, 502);
	const emptyBody = errorBody(empty.json);
	assert.equal(emptyBody.code, 'invalid_model_output');
	// Even an unusable transcription is cleaned up provider-side when its id
	// is trustworthy, and the failure says so honestly without the id.
	assert.match(emptyBody.message, /stored copy was deleted/u);
	assert.equal(emptyBody.message.includes('transcription_stub_1'), false);
	assert.equal(
		stub.deletions.includes('transcription_stub_1'),
		true,
		'the unusable response still triggered the best-effort deletion',
	);
	stub.setMode('ok');
});

test('the reviewed save is CAS-guarded and marks the transcript audio', async () => {
	const uploaded = await transcribe(sessionPath());
	assert.equal(uploaded.status, 200);
	const draft = (uploaded.json as {
		draft: { segments: { speaker: string | null; text: string; startMs: number | null; endMs: number | null }[] };
	}).draft.segments;

	// Consultant review: relabel the anonymized speakers before saving.
	const reviewed = draft.map((segment, index) => ({
		...segment,
		speaker: index === 0 ? '受付' : 'ゲスト',
	}));

	const stale = await call('PUT', `${base.url}${sessionPath()}/transcript`, {
		baseRev: 999,
		source: 'audio',
		segments: reviewed,
	});
	assert.equal(stale.status, 409);
	assert.equal(errorBody(stale.json).code, 'stale_revision');

	const saved = await call('PUT', `${base.url}${sessionPath()}/transcript`, {
		baseRev: 1,
		source: 'audio',
		segments: reviewed,
	});
	assert.equal(saved.status, 200);
	const session = asSession(saved.json);
	assert.equal(session.rev, 2);
	assert.equal(session.transcript?.source, 'audio');
	assert.equal(session.transcript?.segments[0]?.speaker, '受付');
	assert.equal(session.transcript?.segments[0]?.startMs, 0);

	// Later edits without an explicit source keep the audio origin.
	const edited = await call('PUT', `${base.url}${sessionPath()}/transcript`, {
		baseRev: 2,
		segments: reviewed.map((segment, index) => ({
			...segment,
			text: index === 1 ? 'はい、先月予約した佐藤です。' : segment.text,
		})),
	});
	assert.equal(edited.status, 200);
	assert.equal(asSession(edited.json).transcript?.source, 'audio');

	// Nothing was analyzed automatically.
	const reopened = asSession((await call('GET', `${base.url}${sessionPath()}`)).json);
	assert.equal(reopened.discovery, null);
	assert.equal(reopened.workflow.steps.length, 0);
});

test('a paste-only save on a fresh session stays `paste`', async () => {
	const client = await call('POST', `${base.url}/api/clients`, {
		name: 'Paste Only Client',
	});
	assert.equal(client.status, 201);
	const pasteClientId = (client.json as { id: string }).id;
	const created = await call(
		'POST',
		`${base.url}/api/clients/${pasteClientId}/sessions`,
		{ title: 'Pasted intake' },
	);
	assert.equal(created.status, 201);
	const path = `/api/clients/${pasteClientId}/sessions/${(created.json as { id: string }).id}`;
	const saved = await call('PUT', `${base.url}${path}/transcript`, {
		baseRev: 1,
		segments: [{ text: 'Pasted row.', speaker: null, startMs: null, endMs: null }],
	});
	assert.equal(saved.status, 200);
	assert.equal(asSession(saved.json).transcript?.source, 'paste');
});
