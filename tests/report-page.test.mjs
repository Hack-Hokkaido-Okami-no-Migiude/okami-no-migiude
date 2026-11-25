// Report page contract tests (HTTP level against the built server).
//
// What is provable without a browser:
// - The private page route renders server-side without leaking any report
//   data (content, business name, structured sections) while signed out.
// - The report API keeps its §5 contract for the page's reads.
// - Source contract of the owned page/component/locales: no raw-HTML sinks.
//
// Run: npm run build && node --test tests/report-page.test.mjs
import {
	assertBuilt,
	expectErrorCode,
	expectStatus,
	newCookieJar,
	pollUntil,
	repoRoot,
	request,
	startServer,
} from './report-helpers.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const OWNER = {
	email: 'report-page-owner@example.test',
	password: 'owner-page-pass-1234',
	profile: {
		name: 'ページ 花子',
		businessName: 'ペンション木もれび',
		businessType: 'accommodation',
		municipality: 'ニセコ町',
		locale: 'ja',
	},
};

const TRANSCRIPT = [
	'面接者: 課題をお聞かせください。',
	'経営者: 清掃スタッフが足りず、繁忙期は家族で回しています。',
	'経営者: 予約は電話と手書きの予約表です。Web予約はありません。',
].join('\n');

test(
	'report page: private shell, no SSR content leak, source contract',
	{ timeout: 120000 },
	async () => {
		assertBuilt();
		const server = await startServer('report page server', '250');
		try {
			const jar = newCookieJar();

			// Seed one ready report through the API journey.
			const signup = await request(
				server.baseUrl,
				'POST',
				'/api/auth/signup',
				{
					body: OWNER,
					jar,
				},
			);
			expectStatus('signup', signup, 201);
			const start = await request(
				server.baseUrl,
				'POST',
				'/api/interviews/start',
				{
					body: { consent: true, mode: 'demo' },
					jar,
				},
			);
			expectStatus('start', start, 201);
			const complete = await request(
				server.baseUrl,
				'POST',
				`/api/interviews/${start.json.interview.id}/complete`,
				{ body: { transcript: TRANSCRIPT }, jar },
			);
			expectStatus('complete', complete, 200);
			const reportId = complete.json.reportId;
			const ready = await pollUntil('report ready', async () => {
				const response = await request(
					server.baseUrl,
					'GET',
					`/api/reports/${reportId}`,
					{ jar, origin: null },
				);
				expectStatus('report detail', response, 200);
				return response.json.report.status === 'ready' ?
						response
					:	null;
			});
			assert.match(ready.json.report.content, /改善フローの比較/);

			// Signed-out page render: HTTP 200 app shell, zero report data.
			const anonymous = await request(
				server.baseUrl,
				'GET',
				`/reports/${reportId}`,
				{ origin: null },
			);
			expectStatus('anonymous page render', anonymous, 200);
			assert.match(anonymous.text, /data-page="report"/);
			assert.doesNotMatch(anonymous.text, /ペンション木もれび/);
			assert.doesNotMatch(anonymous.text, /改善フロー/);
			assert.doesNotMatch(anonymous.text, /清掃リスト/);
			assert.doesNotMatch(anonymous.text, /客室は8室/);

			// Unknown report id: the page still renders the shell (client handles
			// the 404 through the localized state), API stays in the envelope.
			const unknownPage = await request(
				server.baseUrl,
				'GET',
				`/reports/${'f'.repeat(8)}-0000-4000-8000-000000000000`,
				{ origin: null },
			);
			expectStatus('unknown id page render', unknownPage, 200);
			expectErrorCode(
				'unknown id api',
				await request(
					server.baseUrl,
					'GET',
					`/api/reports/${'f'.repeat(8)}-0000-4000-8000-000000000000`,
					{ jar, origin: null },
				),
				'not_found',
			);

			// Source contract: the owned report UI never renders raw HTML.
			const ownedDirs = [
				path.join('app', 'components', 'report'),
				path.join('app', 'pages', 'reports'),
			];
			const ownedFiles = [];
			for (const dir of ownedDirs) {
				for (const entry of fs.readdirSync(path.join(repoRoot, dir), {
					recursive: true,
				})) {
					const file = path.join(dir, String(entry));
					if (file.endsWith('.vue') || file.endsWith('.ts')) {
						ownedFiles.push(file);
					}
				}
			}
			assert.ok(ownedFiles.length >= 2, 'owned report UI files exist');
			for (const file of ownedFiles) {
				const source = fs.readFileSync(file, 'utf8');
				assert.doesNotMatch(
					source,
					/v-html|innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/,
					`${file} must not render raw HTML`,
				);
			}
		} finally {
			await server.close();
		}
	},
);
