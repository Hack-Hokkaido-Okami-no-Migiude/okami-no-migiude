// Unit tests for the fictional demo script data (contract §11): bilingual
// parity, speaker structure and honest labeling.
import assert from 'node:assert/strict';
import { interviewScript } from '../app/locales/interview-script.ts';
import { interviewStrings } from '../app/locales/interview.ts';
import { renderScriptTranscript } from '../app/utils/interview-transcript.ts';
import test from 'node:test';

test('script exists for both locales with matching structure', () => {
	assert.ok(interviewScript.ja);
	assert.ok(interviewScript.en);
	const ja = interviewScript.ja;
	const en = interviewScript.en;
	assert.equal(ja.lines.length, en.lines.length);
	assert.ok(ja.lines.length >= 8, 'the demo must have a real dialogue');

	for (const locale of [ja, en]) {
		locale.lines.forEach((line, index) => {
			assert.ok(
				line.speaker === 'interviewer' || line.speaker === 'owner',
				`line ${index} speaker`,
			);
			assert.ok(line.text.length > 0, `line ${index} text`);
			assert.ok(
				!line.text.includes('\n'),
				`line ${index} must stay on one line`,
			);
			const expected = index % 2 === 0 ? 'interviewer' : 'owner';
			assert.equal(line.speaker, expected, `line ${index} alternates`);
		});
	}
});

test('speaker labels follow the server transcript conventions', () => {
	assert.equal(interviewScript.ja.speakerLabels.interviewer, '面接者');
	assert.equal(interviewScript.ja.speakerLabels.owner, '経営者');
	assert.equal(interviewScript.en.speakerLabels.interviewer, 'Interviewer');
	assert.equal(interviewScript.en.speakerLabels.owner, 'Owner');
});

test('script is explicitly labeled fictional in both locales', () => {
	for (const locale of [interviewScript.ja, interviewScript.en]) {
		assert.ok(locale.fictionalLabel.length > 0);
		assert.ok(locale.disclaimer.length > 0);
		assert.ok(locale.personaName.length > 0);
	}
	// Contract §11 copy (exact wording may be polished, meaning must remain).
	assert.match(interviewScript.ja.fictionalLabel, /サンプル面談/);
	assert.match(interviewScript.ja.fictionalLabel, /フィクション/);
	assert.match(interviewScript.en.fictionalLabel, /Sample interview/);
	assert.match(interviewScript.en.fictionalLabel, /fictional/i);
});

test('rendered script transcripts use the API journey transcript format', () => {
	const ja = renderScriptTranscript(
		interviewScript.ja.lines,
		interviewScript.ja.speakerLabels,
	);
	assert.ok(ja.startsWith('面接者: '));
	assert.ok(ja.includes('\n経営者: '));
	const en = renderScriptTranscript(
		interviewScript.en.lines,
		interviewScript.en.speakerLabels,
	);
	assert.ok(en.startsWith('Interviewer: '));
	assert.ok(en.includes('\nOwner: '));
});

test('UI strings exist for both locales with identical key sets', () => {
	assert.ok(interviewStrings.ja);
	assert.ok(interviewStrings.en);
	const ja = interviewStrings.ja;
	const en = interviewStrings.en;
	// The type-level parity is enforced in the module itself; this guards
	// against accidental `any` widening.
	assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
	assert.ok(ja.consent.items.processing.label.length > 0);
	assert.ok(en.consent.items.processing.label.length > 0);
	assert.ok(ja.consent.items.processing.detail.length > 0);
	assert.ok(en.consent.items.processing.detail.length > 0);
});
