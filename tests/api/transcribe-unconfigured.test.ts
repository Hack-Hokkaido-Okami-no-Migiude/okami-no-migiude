// Without NUXT_ELEVENLABS_API_KEY the recorded-upload route must fail closed
// with `provider_unconfigured` and never contact any provider.
import { after, before, test } from 'node:test';
import { call, errorBody, startServer, stopServer } from './helpers/server';
import type { Session } from '../../shared/p0/types';
import assert from 'node:assert/strict';

const base = { url: '' };
let clientId = '';
let sessionId = '';

before(async () => {
	// No `audio` option: the harness deliberately leaves the provider unset.
	base.url = await startServer();
	const client = await call('POST', `${base.url}/api/clients`, {
		name: 'Unconfigured Client',
	});
	clientId = (client.json as { id: string }).id;
	const created = await call(
		'POST',
		`${base.url}/api/clients/${clientId}/sessions`,
		{ title: 'Unconfigured' },
	);
	sessionId = (created.json as { id: string }).id;
});

after(async () => {
	await stopServer();
});

test('the transcribe route fails closed without configuration', async () => {
	const form = new FormData();
	const wav = Buffer.alloc(64, 0x52);
	wav.write('RIFF', 0, 'latin1');
	wav.write('WAVE', 8, 'latin1');
	form.append('file', new Blob([wav]), 'recording.wav');
	form.append('consent', 'true');
	const response = await fetch(
		`${base.url}/api/clients/${clientId}/sessions/${sessionId}/transcribe`,
		{ method: 'POST', body: form },
	);
	assert.equal(response.status, 503);
	assert.equal(errorBody(await response.json()).code, 'provider_unconfigured');

	const session = (await call(
		'GET',
		`${base.url}/api/clients/${clientId}/sessions/${sessionId}`,
	)).json as Session;
	assert.equal(session.transcript, null);
	assert.equal(session.rev, 1);
});
