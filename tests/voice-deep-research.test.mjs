// Unit tests for the post-call deep-research composer (leaf module: both of
// its imports are type-only, and the keyword tables in server/analyze/rules.ts
// carry no runtime imports either). The full deep-pass pipeline is exercised
// end to end by tests/voice-journey.test.mjs against a loopback Linkup stub.
// Run: node --test tests/voice-deep-research.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { TOPICS } from '../server/analyze/rules.ts';
import {
	DEEP_RESEARCH_REASONING_DEPTH,
	DEEP_RESEARCH_TIMEOUT_MS,
	deepResearchPrompt,
	matchedTopicTitles,
} from '../server/voice/deep-research.ts';

const BUSINESS = { location: 'ニセコ町', businessType: 'Accommodation' };

test('the deep pass uses the heaviest reasoning depth', () => {
	assert.equal(DEEP_RESEARCH_REASONING_DEPTH, 'XL');
	// Above XL's documented 10–20 minute latency ceiling.
	assert.ok(DEEP_RESEARCH_TIMEOUT_MS >= 20 * 60_000);
});

test('a Japanese transcript fills the focus topics and intake', () => {
	const transcript = 'オーナー: 従業員が足りなくて困っています。';
	const prompt = deepResearchPrompt(
		BUSINESS,
		transcript,
		TOPICS,
		'ja',
	);
	assert.match(prompt, /人材の確保と定着/);
	assert.match(prompt, /ニセコ町/);
	assert.match(prompt, /Accommodation/);
	assert.doesNotMatch(prompt, /\[(LOCATION|BUSINESS_TYPE|FOCUS)\]/);
});

test('an English transcript produces English titles with a comma list', () => {
	const transcript = 'Owner: our staff turnover is high in winter.';
	const prompt = deepResearchPrompt(
		BUSINESS,
		transcript,
		TOPICS,
		'en',
	);
	assert.match(prompt, /Staffing and retention/);
});

test('a transcript without keyword matches ships no focus block', () => {
	const prompt = deepResearchPrompt(
		BUSINESS,
		'Owner: こんにちは。',
		TOPICS,
		'ja',
	);
	assert.doesNotMatch(prompt, /Focus topics/);
});

test('matching is capped and accepts topics from either language table', () => {
	const titles = matchedTopicTitles(
		'従業員 staff 季節 hiring',
		TOPICS,
		'ja',
	);
	assert.ok(titles.length > 0);
	assert.ok(titles.length <= 4);
	assert.ok(titles.includes('人材の確保と定着'));
});

test('the deep-pass prompt asks for a full technical dossier', () => {
	const prompt = deepResearchPrompt(BUSINESS, '', TOPICS, 'ja');
	assert.match(prompt, /Named tools and services/);
	assert.match(prompt, /Implementation effort and technical detail/);
	assert.match(prompt, /Documented results/);
	assert.match(prompt, /Risks, pitfalls/);
});
