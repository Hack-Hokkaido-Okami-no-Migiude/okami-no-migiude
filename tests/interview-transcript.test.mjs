// Unit tests for transcript validation, script rendering and the draft store.
import assert from 'node:assert/strict';
import {
	TRANSCRIPT_MAX_CHARS,
	checkTranscript,
	renderScriptTranscript,
} from '../app/utils/interview-transcript.ts';
import { createDraftStore, draftKey } from '../app/utils/interview-draft.ts';
import test from 'node:test';

test('checkTranscript: trim, emptiness and the 200k contract limit', () => {
	assert.deepEqual(checkTranscript('  hello \n\t '), {
		ok: true,
		value: 'hello',
	});
	assert.deepEqual(checkTranscript(''), { ok: false, reason: 'empty' });
	assert.deepEqual(checkTranscript('   \n\t  '), {
		ok: false,
		reason: 'empty',
	});

	const exact = 'a'.repeat(TRANSCRIPT_MAX_CHARS);
	assert.equal(TRANSCRIPT_MAX_CHARS, 200_000);
	assert.deepEqual(checkTranscript(exact), { ok: true, value: exact });
	const tooLong = 'a'.repeat(TRANSCRIPT_MAX_CHARS + 1);
	assert.deepEqual(checkTranscript(tooLong), {
		ok: false,
		reason: 'too_long',
	});
	// Trailing whitespace does not count against the limit after trimming.
	assert.deepEqual(
		checkTranscript(`${'a'.repeat(TRANSCRIPT_MAX_CHARS)}\n\n  `),
		{ ok: true, value: 'a'.repeat(TRANSCRIPT_MAX_CHARS) },
	);
});

test('renderScriptTranscript prefixes each line with the speaker label', () => {
	const rendered = renderScriptTranscript(
		[
			{ speaker: 'interviewer', text: 'こんにちは' },
			{ speaker: 'owner', text: 'はじめまして' },
		],
		{ interviewer: '面接者', owner: '経営者' },
	);
	assert.equal(rendered, '面接者: こんにちは\n経営者: はじめまして');

	assert.equal(
		renderScriptTranscript([], { interviewer: 'A', owner: 'B' }),
		'',
	);
});

function fakeStorage(initial = {}) {
	const map = new Map(Object.entries(initial));
	const failing = { value: false };
	return {
		map,
		failing,
		getItem(key) {
			if (failing.value) {
				throw new Error('storage unavailable');
			}
			return map.has(key) ? map.get(key) : null;
		},
		setItem(key, value) {
			if (failing.value) {
				throw new Error('storage unavailable');
			}
			map.set(key, value);
		},
		removeItem(key) {
			if (failing.value) {
				throw new Error('storage unavailable');
			}
			map.delete(key);
		},
	};
}

test('draftKey is namespaced per interview', () => {
	assert.equal(draftKey('abc'), 'interview-draft:abc');
});

test('draft store roundtrips and swallows storage errors', () => {
	const storage = fakeStorage();
	const store = createDraftStore(storage);

	assert.equal(store.load('i-1'), '');
	store.save('i-1', 'draft text');
	assert.equal(store.load('i-1'), 'draft text');
	assert.equal(storage.map.get(draftKey('i-1')), 'draft text');

	store.clear('i-1');
	assert.equal(store.load('i-1'), '');
	assert.equal(storage.map.has(draftKey('i-1')), false);

	// Missing keys and previously cleared ids both load as empty.
	assert.equal(store.load('i-2'), '');

	// Storage failures must never crash the page.
	storage.failing.value = true;
	assert.equal(store.load('i-1'), '');
	assert.doesNotThrow(() => store.save('i-1', 'x'));
	assert.doesNotThrow(() => store.clear('i-1'));
});
