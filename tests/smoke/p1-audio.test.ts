// Recorded-upload smoke over the built server's dynamic HTTP path: a loopback
// stub stands in for the ElevenLabs batch speech-to-text API, a fresh client
// and session are created through the published API, the recorded upload
// returns unpersisted review rows, the consent gate blocks without consent,
// and the intentional CAS-guarded save persists an `audio` transcript that
// survives reopening. No real provider credentials, no real audio network.
import { type AudioStub, startAudioStub } from '../api/helpers/audio-stub';
import {
	type SmokeServer,
	call,
	errorBody,
	startSmokeServer,
} from './helpers/server';
import { after, before, test } from 'node:test';
import type { Session } from '../../shared/p0/types';
import assert from 'node:assert/strict';

const serverBox: { server: SmokeServer | null } = { server: null };
let stub: AudioStub;
let clientId = '';
let sessionId = '';

/** The same minimal valid WAV builder the API tests use. */
function wavBytes(seconds = 0.2): Buffer {
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

async function transcribe(consent: 'true' | null): Promise<Response> {
	const form = new FormData();
	form.append('file', new Blob([wavBytes()], { type: 'audio/wav' }), 'interview.wav');
	if (consent !== null) {
		form.append('consent', consent);
	}
	return fetch(
		`http://127.0.0.1:${serverBox.server?.port}/api/clients/${clientId}/sessions/${sessionId}/transcribe`,
		{ method: 'POST', body: form },
	);
}

before(async () => {
	stub = await startAudioStub();
	serverBox.server = await startSmokeServer({
		audio: { baseUrl: stub.url, apiKey: 'stub-key-smoke' },
	});
	const { port } = serverBox.server;
	const client = await call(port, 'POST', '/api/clients', { name: 'Smoke Audio' });
	clientId = (client.body as { id: string }).id;
	const created = await call(
		port,
		'POST',
		`/api/clients/${clientId}/sessions`,
		{ title: 'Recorded smoke' },
	);
	sessionId = (created.body as { id: string }).id;
});

after(async () => {
	await serverBox.server?.stop();
	await stub.close();
});

test('without consent the upload fails closed before any provider call', async () => {
	const response = await transcribe(null);
	assert.equal(response.status, 422);
	assert.equal(errorBody(await response.json()).code, 'consent_required');
	assert.equal(stub.requestCount(), 0);
});

test('the built server returns unpersisted diarized review rows', async () => {
	const response = await transcribe('true');
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		draft: { source: string; segments: { speaker: string; text: string; startMs: number; endMs: number }[] };
		languageCode: string | null;
		cleanup: string;
	};
	assert.equal(body.draft.source, 'audio');
	assert.deepEqual(body.draft.segments, [
		{ speaker: 'Speaker 1', text: '受付です、ご予約ですね。', startMs: 0, endMs: 2400 },
		{ speaker: 'Speaker 2', text: 'はい、先月予約した佐藤です', startMs: 2900, endMs: 5400 },
	]);
	assert.equal(body.languageCode, 'jpn');
	assert.equal(body.cleanup, 'deleted');
	assert.deepEqual(stub.deletions, ['transcription_stub_1']);

	// Nothing was persisted by the transcribe call itself.
	const session = (
		await call(serverBox.server?.port ?? 0, 'GET', `/api/clients/${clientId}/sessions/${sessionId}`)
	).body as Session;
	assert.equal(session.rev, 1);
	assert.equal(session.transcript, null);
});

test('the reviewed save persists an audio transcript with current CAS', async () => {
	const response = await transcribe('true');
	const draft = ((await response.json()) as {
		draft: { segments: { speaker: string; text: string; startMs: number; endMs: number }[] };
	}).draft.segments;
	const reviewed = draft.map((segment, index) => ({
		...segment,
		speaker: index === 0 ? 'フロント' : 'ゲスト',
	}));
	const saved = await call(
		serverBox.server?.port ?? 0,
		'PUT',
		`/api/clients/${clientId}/sessions/${sessionId}/transcript`,
		{ baseRev: 1, source: 'audio', segments: reviewed },
	);
	assert.equal(saved.status, 200);
	const session = saved.body as Session;
	assert.equal(session.transcript?.source, 'audio');
	assert.equal(session.transcript?.segments[0]?.speaker, 'フロント');

	const reopened = (
		await call(serverBox.server?.port ?? 0, 'GET', `/api/clients/${clientId}/sessions/${sessionId}`)
	).body as Session;
	assert.equal(reopened.transcript?.source, 'audio');
	assert.equal(reopened.transcript?.segments[1]?.text, 'はい、先月予約した佐藤です');
});
