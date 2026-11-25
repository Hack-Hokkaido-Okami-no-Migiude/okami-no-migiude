// Unit tests for the ElevenLabs webhook helpers: HMAC verification, the
// transcript turn formatter, the bounded webhook string checks and the
// timing-safe secret comparison. Pure node:test — imports the TS server
// module directly (Node type stripping, no app build required).
// Run: node --test tests/voice-webhooks.test.mjs
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AGENT_LABEL,
	OWNER_LABEL,
	readWebhookInterviewId,
	requiredWebhookString,
	secretMatches,
	toTranscript,
	verifyWebhook,
} from '../server/voice/webhooks.ts';

const SECRET = 'whsec_unit_test';

function signRaw(raw, timestampSeconds, secret = SECRET) {
	const digest = createHmac('sha256', secret)
		.update(`${timestampSeconds}.`)
		.update(raw)
		.digest('hex');
	return `t=${timestampSeconds},v0=${digest}`;
}

test('verifyWebhook accepts a correctly signed body inside the window', () => {
	const raw = Buffer.from('{"type":"post_call_transcription"}', 'utf8');
	assert.equal(
		verifyWebhook(raw, signRaw(raw, Math.floor(Date.now() / 1000)), SECRET),
		true,
	);
});

test('verifyWebhook accepts uppercase hex signatures and extra fields', () => {
	const raw = Buffer.from('{"x":1}', 'utf8');
	const timestamp = Math.floor(Date.now() / 1000);
	const header = signRaw(raw, timestamp).toUpperCase().replace('T=', 't=');
	assert.equal(verifyWebhook(raw, header, SECRET), true);
});

test('verifyWebhook rejects a wrong secret, tampered body and bad headers', () => {
	const raw = Buffer.from('{"type":"post_call_transcription"}', 'utf8');
	const timestamp = Math.floor(Date.now() / 1000);
	assert.equal(
		verifyWebhook(raw, signRaw(raw, timestamp, 'other-secret'), SECRET),
		false,
	);
	assert.equal(
		verifyWebhook(
			Buffer.from('{"type":"tampered"}', 'utf8'),
			signRaw(raw, timestamp),
			SECRET,
		),
		false,
	);
	assert.equal(verifyWebhook(raw, null, SECRET), false);
	assert.equal(verifyWebhook(raw, '', SECRET), false);
	assert.equal(verifyWebhook(raw, 't=abc,v0=deadbeef', SECRET), false);
	assert.equal(
		verifyWebhook(raw, `t=${timestamp},v0=not-hex`, SECRET),
		false,
	);
	assert.equal(
		verifyWebhook(raw, `v0=${'a'.repeat(64)},t=${timestamp}`, SECRET),
		false,
	);
});

test('verifyWebhook enforces the 30-minute signature window', () => {
	const raw = Buffer.from('{"x":2}', 'utf8');
	const nowSeconds = Math.floor(Date.now() / 1000);
	// One second inside/ outside the window: the verifier re-reads the clock,
	// so exact-boundary assertions would be flaky.
	assert.equal(
		verifyWebhook(raw, signRaw(raw, nowSeconds - 1799), SECRET),
		true,
	);
	assert.equal(
		verifyWebhook(raw, signRaw(raw, nowSeconds + 1799), SECRET),
		true,
	);
	assert.equal(
		verifyWebhook(raw, signRaw(raw, nowSeconds - 1801), SECRET),
		false,
	);
	assert.equal(
		verifyWebhook(raw, signRaw(raw, nowSeconds + 1801), SECRET),
		false,
	);
});

test('toTranscript renders Owner / Shima Enaga lines from clean turns', () => {
	assert.equal(
		toTranscript([
			{ role: 'agent', message: 'こんにちは。始めましょう。' },
			{ role: 'user', message: ' こんにちは ' },
			{ role: 'agent', message: '研究が完了しました。' },
		]),
		[
			`${AGENT_LABEL}: こんにちは。始めましょう。`,
			`${OWNER_LABEL}: こんにちは`,
			`${AGENT_LABEL}: 研究が完了しました。`,
		].join('\n'),
	);
});

test('toTranscript drops junk turns and handles non-arrays', () => {
	assert.equal(
		toTranscript([
			{ role: 'user', message: '   ' },
			{ role: 'intern', message: 'nope' },
			{ message: 'no role' },
			'plain string',
			null,
			{ role: 'agent', message: 'kept' },
		]),
		`${AGENT_LABEL}: kept`,
	);
	assert.equal(toTranscript('not an array'), '');
	assert.equal(toTranscript(null), '');
});

test('requiredWebhookString bounds values and rejects control characters', () => {
	assert.equal(requiredWebhookString({ id: ' conv_1 ' }, 'id'), 'conv_1');
	assert.equal(requiredWebhookString({ id: 42 }, 'id'), '');
	assert.equal(requiredWebhookString({ id: '' }, 'id'), '');
	assert.equal(requiredWebhookString({ id: 'a\nb' }, 'id'), '');
	assert.equal(requiredWebhookString({ id: 'a\rb' }, 'id'), '');
	assert.equal(requiredWebhookString({ id: 'x'.repeat(201) }, 'id'), '');
	assert.equal(
		requiredWebhookString({ id: 'x'.repeat(200) }, 'id'),
		'x'.repeat(200),
	);
	assert.equal(
		requiredWebhookString({ id: 'x'.repeat(300) }, 'id', 512).length,
		300,
	);
});

test('secretMatches compares secrets in constant time by hash', () => {
	assert.equal(secretMatches('tool-secret', 'tool-secret'), true);
	assert.equal(secretMatches('tool-secret ', 'tool-secret'), false);
	assert.equal(secretMatches('', ''), true);
	assert.equal(secretMatches('a', 'b'), false);
	assert.equal(secretMatches('a', ''), false);
});

test('readWebhookInterviewId picks the interview id dynamic variable', () => {
	const data = {
		conversation_initiation_client_data: {
			dynamic_variables: {
				interview_id: ' 01890a5e-7f2b-7d92-a111-000000000001 ',
				web_business_context: '{"business_name":"x"}',
				system__call_duration_secs: 900,
			},
		},
	};
	assert.equal(
		readWebhookInterviewId(data),
		'01890a5e-7f2b-7d92-a111-000000000001',
	);
});

test('readWebhookInterviewId returns empty for junk shapes', () => {
	assert.equal(readWebhookInterviewId({}), '');
	assert.equal(readWebhookInterviewId({ conversation_initiation_client_data: null }), '');
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: { dynamic_variables: 'nope' },
		}),
		'',
	);
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: {
				dynamic_variables: { interview_id: 42 },
			},
		}),
		'',
	);
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: {
				dynamic_variables: { interview_id: '' },
			},
		}),
		'',
	);
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: {
				dynamic_variables: { interview_id: 'a\nb' },
			},
		}),
		'',
	);
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: {
				dynamic_variables: { interview_id: 'x'.repeat(65) },
			},
		}),
		'',
	);
	assert.equal(
		readWebhookInterviewId({
			conversation_initiation_client_data: {
				dynamic_variables: { interview_id: 'x'.repeat(64) },
			},
		}),
		'x'.repeat(64),
	);
});
