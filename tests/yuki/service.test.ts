import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { researchPrompt } from '../../server/yuki/research-prompt';
import { readYukiConfig } from '../../server/yuki/runtime';
import { createYukiVoice } from '../../server/yuki/service';

const config = {
	databasePath: ':memory:',
	accessToken: 'test-access-code',
	researchToolSecret: 'test-tool-secret',
	elevenLabsWebhookSecret: 'test-webhook-secret',
	elevenLabsApiKey: 'test-elevenlabs-key',
	elevenLabsAgentId: 'agent_test',
	linkupApiKey: 'test-linkup-key',
	difyApiKey: 'test-dify-key',
};

function transcriptEvent(
	id: string,
	timestamp = Math.floor(Date.now() / 1000),
) {
	const raw = Buffer.from(
		JSON.stringify({
			type: 'post_call_transcription',
			data: {
				agent_id: config.elevenLabsAgentId,
				conversation_id: id,
				transcript: [
					{ role: 'agent', message: 'What takes the most time?' },
					{ role: 'user', message: 'Copying bookings.' },
					{
						role: 'agent',
						message: null,
						tool_results: ['metadata'],
					},
				],
			},
		}),
	);
	const digest = createHmac('sha256', config.elevenLabsWebhookSecret)
		.update(`${timestamp}.`)
		.update(raw)
		.digest('hex');
	return { raw, signature: `t=${timestamp},v0=${digest}` };
}

function researchBody(id: string) {
	return async () =>
		Buffer.from(
			JSON.stringify({
				conversation_id: id,
				business_name: 'Okami Inn',
				location: 'Jozankei',
				business_type: 'Inn',
			}),
		);
}

async function until(condition: () => boolean) {
	const deadline = Date.now() + 3_000;
	while (!condition()) {
		if (Date.now() > deadline) {
			assert.fail('Timed out waiting for job state');
		}
		await delay(10);
	}
}

test('voice test is off without the tester code even when provider settings exist', () => {
	assert.equal(readYukiConfig({ ELEVENLABS_API_KEY: 'test-key' }), undefined);
});

test('one authenticated call survives restart and produces one Japanese report with sourced cases', async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'shima-yuki-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	let allowResearchResult = false;
	let sessionsStarted = 0;
	let submitted = 0;
	let polled = 0;
	const reportInputs: unknown[] = [];
	const source = 'https://example.org/case-study';
	const mockFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		if (url.hostname === 'api.elevenlabs.io') {
			assert.equal(url.pathname, '/v1/convai/conversation/token');
			assert.equal(
				url.searchParams.get('agent_id'),
				config.elevenLabsAgentId,
			);
			assert.equal(headers.get('xi-api-key'), config.elevenLabsApiKey);
			return Response.json({
				token: 'rtc-token',
				conversation_id: `conv_test_${++sessionsStarted}`,
			});
		}
		if (url.hostname === 'api.linkup.so') {
			assert.equal(
				headers.get('authorization'),
				`Bearer ${config.linkupApiKey}`,
			);
			if (init?.method === 'POST') {
				submitted++;
				const payload = JSON.parse(String(init.body));
				assert.match(payload.q, /Okami Inn/);
				assert.match(payload.q, /Jozankei/);
				assert.equal(payload.reasoningDepth, 'S');
				assert.equal(payload.outputType, 'structured');
				return Response.json({ id: 'linkup-job' });
			}
			assert.equal(url.pathname, '/v1/research/linkup-job');
			if (++polled === 1) {
				return new Response(null, { status: 503 });
			}
			if (!allowResearchResult) {
				return Response.json({ status: 'processing' });
			}
			return Response.json({
				status: 'completed',
				output: {
					cases: [
						{
							company: 'Similar Inn',
							solution: 'Booking alerts',
							source_urls: [source],
						},
						{
							company: 'Unsourced Inn',
							solution: 'No source',
							source_urls: [],
						},
					],
				},
			});
		}
		assert.equal(url.hostname, 'api.dify.ai');
		assert.equal(
			headers.get('authorization'),
			`Bearer ${config.difyApiKey}`,
		);
		reportInputs.push(JSON.parse(String(init?.body)).inputs);
		return Response.json({
			data: {
				status: 'succeeded',
				outputs: { report: 'Assessment draft' },
			},
		});
	};

	const onDisk = { ...config, databasePath: join(directory, 'yuki.sqlite') };
	const options = { fetch: mockFetch, tickMs: 10, pollMs: 15 };
	let voice = createYukiVoice(onDisk, researchPrompt, options);
	try {
		await assert.rejects(voice.startSession(undefined), { status: 401 });
		assert.equal(sessionsStarted, 0);
		const session = await voice.startSession(
			`Bearer ${config.accessToken}`,
		);
		assert.equal(session.conversation_token, 'rtc-token');
		const id = session.conversation_id;
		const bearer = `Bearer ${session.access_token}`;
		const other = await voice.startSession(`Bearer ${config.accessToken}`);
		assert.throws(() => voice.session(id, `Bearer ${other.access_token}`), {
			status: 404,
		});
		await assert.rejects(voice.startResearch(undefined, researchBody(id)), {
			status: 401,
		});
		const tool = `Bearer ${config.researchToolSecret}`;
		assert.deepEqual(await voice.startResearch(tool, researchBody(id)), {
			status: 'queued',
		});
		await voice.startResearch(tool, researchBody(id));
		const expired = transcriptEvent(id, 1);
		assert.throws(() => voice.postCall(expired.raw, expired.signature), {
			status: 401,
		});
		const { raw, signature } = transcriptEvent(id);
		assert.throws(
			() =>
				voice.postCall(
					Buffer.concat([raw, Buffer.from(' ')]),
					signature,
				),
			{ status: 401 },
		);
		assert.deepEqual(voice.postCall(raw, signature), { received: true });
		voice.postCall(raw, signature);
		await until(() => polled >= 2);
		assert.equal(reportInputs.length, 0);

		await voice.close();
		allowResearchResult = true;
		voice = createYukiVoice(onDisk, researchPrompt, options);
		await until(
			() => voice.session(id, bearer).report.status === 'completed',
		);
		const status = voice.session(id, bearer);
		assert.equal(status.research.cases.length, 1);
		assert.deepEqual(status.research.cases[0]?.source_urls, [source]);
		assert.equal(status.report.text, 'Assessment draft');
		assert.equal(Object.hasOwn(status, 'transcript'), false);
		assert.equal(submitted, 1);
		assert.deepEqual(reportInputs, [
			{
				report_language: 'Japanese',
				transcript:
					'Yuki: What takes the most time?\nOwner: Copying bookings.',
				research_cases: JSON.stringify(status.research.cases),
			},
		]);
	} finally {
		await voice.close();
	}
});

test('a failed Linkup task still lets Dify assess the transcript', async () => {
	const mockFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		if (url.hostname === 'api.elevenlabs.io') {
			return Response.json({
				token: 'rtc-token',
				conversation_id: 'conv_failed',
			});
		}
		if (url.hostname === 'api.linkup.so') {
			return init?.method === 'POST' ?
					Response.json({ id: 'linkup-failed' })
				:	Response.json({ status: 'failed' });
		}
		assert.equal(
			JSON.parse(String(init?.body)).inputs.research_cases,
			'[]',
		);
		return Response.json({
			data: {
				status: 'succeeded',
				outputs: { report: 'Assessment without research' },
			},
		});
	};
	const voice = createYukiVoice(config, researchPrompt, {
		fetch: mockFetch,
		tickMs: 10,
		pollMs: 10,
	});
	try {
		const session = await voice.startSession(
			`Bearer ${config.accessToken}`,
		);
		const id = session.conversation_id;
		await voice.startResearch(
			`Bearer ${config.researchToolSecret}`,
			researchBody(id),
		);
		const { raw, signature } = transcriptEvent(id);
		voice.postCall(raw, signature);
		const status = () =>
			voice.session(id, `Bearer ${session.access_token}`);
		await until(() => status().report.status === 'completed');
		assert.equal(status().research.status, 'failed');
		assert.equal(status().report.text, 'Assessment without research');
	} finally {
		await voice.close();
	}
});
