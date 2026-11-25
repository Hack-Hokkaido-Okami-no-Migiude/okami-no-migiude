// Harness probe: import the TS analyzer from node --test via the resolve hook.
import { registerHooks } from 'node:module';

import { resolve } from './report-ts-hook.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

registerHooks({ resolve });

test('probe: analyzer TS module loads and generates', async () => {
	const { generateReportContent } =
		await import('../server/analyze/index.ts');
	const content = generateReportContent(
		'経営者: 人手不足と繁忙期の話。電話予約が中心です。',
		{
			businessName: 'テスト旅館',
			businessType: 'accommodation',
			municipality: 'ニセコ町',
			locale: 'ja',
		},
		'2026-11-25T09:00:00.000Z',
	);
	assert.match(content, /^# /m);
});
