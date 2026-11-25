import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startServer, stopServer } from './helpers/server';

after(stopServer);

test('Shima renders the Yuki page and its voice routes stay closed by default', async () => {
	const base = await startServer();
	const page = await fetch(`${base}/voice-test`);
	assert.equal(page.status, 200);
	assert.match(await page.text(), /ユキの通話テスト/);
	for (const [method, path] of [
		['POST', '/api/voice-test/sessions'],
		['GET', '/api/voice-test/sessions/unknown'],
		['POST', '/api/elevenlabs/start-research'],
		['POST', '/api/elevenlabs/post-call'],
	]) {
		const response = await fetch(`${base}${path}`, { method });
		assert.equal(response.status, 503, `${method} ${path}`);
		assert.equal(response.headers.get('cache-control'), 'no-store');
	}
});
