// Snow-day journey (#21): spawns the built Nitro server with a loopback stub
// for the JMA open data (via the JMA_BASE_URL QA override) and exercises the
// flow end to end: area lookup, a live heavy snow warning, sample guests,
// one draft per guest in the guest's language, approve-before-send, the
// local guest outbox, the demo simulation, and owner scoping.
// Run: node --test tests/snow-journey.test.mjs   (needs `npm run build`)
import {
	assertBuilt,
	expectStatus,
	newCookieJar,
	pollUntil,
	repoRoot,
	request,
	serverEntry,
} from './report-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

// Minimal JMA fixtures in the live shapes (area.json and warning/data/r8).
const AREA = {
	centers: {},
	offices: {
		'016000': {
			name: '石狩・空知・後志地方',
			enName: 'Ishikari, Sorachi and Shiribeshi',
		},
	},
	class10s: { '016010': { name: '石狩地方', parent: '016000' } },
	class15s: { '016012': { name: '札幌地域', parent: '016010' } },
	class20s: {
		'0110000': { name: '札幌市', enName: 'Sapporo City', parent: '016012' },
	},
};
const WARNINGS = [
	{
		reportDatetime: '2026-11-26T05:00:00+09:00',
		warning: {
			class20Items: [
				{
					areaCode: '0110000',
					kinds: [
						{ code: '06', status: '発表' },
						{ code: '15', status: '継続' },
					],
				},
			],
		},
	},
	{
		reportDatetime: '2026-11-25T22:00:00+09:00',
		warning: {
			class20Items: [
				{
					areaCode: '0110000',
					kinds: [{ code: '13', status: '解除' }],
				},
			],
		},
	},
];

function startJmaStub() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const body =
				req.url === '/bosai/common/const/area.json' ? AREA
				: req.url === '/bosai/warning/data/r8/016000.json' ? WARNINGS
				: null;
			res.writeHead(body ? 200 : 404, {
				'content-type': 'application/json',
			});
			res.end(JSON.stringify(body ?? {}));
		});
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

async function startServer(jmaBaseUrl, dataDir) {
	const port = await new Promise((resolve) => {
		const probe = http.createServer();
		probe.listen(0, '127.0.0.1', () => {
			const p = probe.address().port;
			probe.close(() => resolve(p));
		});
	});
	const baseUrl = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, [serverEntry], {
		cwd: repoRoot,
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			DATA_DIR: dataDir,
			PUBLIC_BASE_URL: baseUrl,
			STAFF_EMAILS: 'staff@example.test',
			STAFF_PASSWORD: 'test-staff-password-1234',
			JMA_BASE_URL: jmaBaseUrl,
			NEON_DATABASE_URL: '',
		},
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	await pollUntil('snow server ready', async () => {
		const probe = await request(baseUrl, 'GET', '/', { origin: null });
		return probe.status === 200;
	});
	return {
		baseUrl,
		close: async () => {
			child.kill();
			await pollUntil(
				'snow server exit',
				async () =>
					child.exitCode !== null || child.signalCode !== null,
				10000,
				100,
			);
		},
	};
}

async function signup(baseUrl, email, municipality) {
	const jar = newCookieJar();
	const response = await request(baseUrl, 'POST', '/api/auth/signup', {
		body: {
			email,
			password: 'snow-owner-pass-1234',
			profile: {
				name: '雪見 女将',
				businessName: 'やまなみ荘',
				businessType: 'accommodation',
				municipality,
				phone: '011-000-0000',
				locale: 'ja',
			},
		},
		jar,
	});
	expectStatus(`signup ${email}`, response, 201);
	return jar;
}

test(
	'snow-day flow: JMA warning to approved, sent guest messages',
	{ timeout: 120000 },
	async () => {
		assertBuilt();
		const stub = await startJmaStub();
		const dataDir = path.join(
			repoRoot,
			'.data',
			'test',
			`snow-${process.pid}`,
		);
		fs.rmSync(dataDir, { recursive: true, force: true });
		const server = await startServer(
			`http://127.0.0.1:${stub.address().port}`,
			dataDir,
		);
		try {
			const base = server.baseUrl;

			// Signed out: 401.
			expectStatus(
				'signed out',
				await request(base, 'GET', '/api/snow', { origin: null }),
				401,
			);

			const jar = await signup(base, 'snow-owner@example.test', '札幌市');
			let page = await request(base, 'GET', '/api/snow', {
				jar,
				origin: null,
			});
			expectStatus('snow page', page, 200);
			assert.equal(page.json.area.nameJa, '札幌市');
			assert.equal(page.json.area.officeCode, '016000');
			assert.equal(page.json.weather.status, 'ok');
			assert.deepEqual(
				page.json.weather.active.map((k) => k.code),
				['06'],
			);
			assert.equal(page.json.guests.length, 0);

			// Sample guests: 4 guests, one per language, today and tomorrow.
			page = await request(base, 'POST', '/api/snow/sample-guests', {
				jar,
				body: {},
			});
			expectStatus('sample guests', page, 200);
			assert.deepEqual(page.json.guests.map((g) => g.language).sort(), [
				'en',
				'ja',
				'ko',
				'zh-TW',
			]);
			assert.equal(
				page.json.guests.filter(
					(g) => g.arrivalDate === page.json.today,
				).length,
				2,
			);
			assert.equal(
				page.json.guests.filter(
					(g) => g.arrivalDate === page.json.tomorrow,
				).length,
				2,
			);

			// Drafts from the live (stubbed) JMA warning.
			page = await request(base, 'POST', '/api/snow/drafts', {
				jar,
				body: { mode: 'jma' },
			});
			expectStatus('jma drafts', page, 200);
			assert.equal(page.json.created, 4);
			const byLang = Object.fromEntries(
				page.json.guests.map((g) => [g.language, g.message]),
			);
			assert.ok(byLang.ja.body.includes('大雪警報'));
			assert.ok(byLang.ja.body.includes('やまなみ荘'));
			assert.ok(byLang.en.body.includes('a heavy snow warning'));
			assert.ok(byLang['zh-TW'].body.includes('大雪警報'));
			assert.ok(byLang.ko.body.includes('대설경보'));
			assert.equal(byLang.ko.trigger, 'jma');
			assert.ok(
				byLang.ko.glossJa.includes('大雪警報'),
				'Japanese gloss for the okami',
			);
			for (const message of Object.values(byLang)) {
				assert.equal(message.status, 'draft');
			}

			// No duplicates on a second press.
			page = await request(base, 'POST', '/api/snow/drafts', {
				jar,
				body: { mode: 'jma' },
			});
			assert.equal(page.json.created, 0);

			// A draft cannot be sent before approval.
			const ko = byLang.ko;
			const early = await request(
				base,
				'POST',
				`/api/snow/messages/${ko.id}`,
				{ jar, body: { action: 'send' } },
			);
			expectStatus('send before approve', early, 409);

			// Approve with an edit, then send.
			const edited = `${ko.body}\n\n추신: 체크인은 22시까지 가능합니다.`;
			page = await request(base, 'POST', `/api/snow/messages/${ko.id}`, {
				jar,
				body: { action: 'approve', body: edited },
			});
			expectStatus('approve', page, 200);
			let message = page.json.guests.find(
				(g) => g.language === 'ko',
			).message;
			assert.equal(message.status, 'approved');
			assert.equal(message.body, edited);
			const lateEdit = await request(
				base,
				'POST',
				`/api/snow/messages/${ko.id}`,
				{ jar, body: { action: 'save', body: 'x' } },
			);
			expectStatus('edit after approval', lateEdit, 409);
			page = await request(base, 'POST', `/api/snow/messages/${ko.id}`, {
				jar,
				body: { action: 'send' },
			});
			expectStatus('send', page, 200);
			message = page.json.guests.find((g) => g.language === 'ko').message;
			assert.equal(message.status, 'sent');
			assert.ok(message.sentAt >= message.approvedAt);
			const outbox = fs.readFileSync(
				path.join(dataDir, 'guest-outbox', `${ko.id}.txt`),
				'utf8',
			);
			assert.ok(outbox.includes('체크인은 22시까지'));

			// Discard a draft; a new draft can then be made for that guest only.
			await request(base, 'POST', `/api/snow/messages/${byLang.en.id}`, {
				jar,
				body: { action: 'discard' },
			});
			page = await request(base, 'POST', '/api/snow/drafts', {
				jar,
				body: { mode: 'simulate' },
			});
			assert.equal(page.json.created, 1);
			assert.equal(
				page.json.guests.find((g) => g.language === 'en').message
					.trigger,
				'simulated',
			);

			// Another owner cannot touch these messages; staff cannot use the page.
			const other = await signup(
				base,
				'other-owner@example.test',
				'どこにもない町',
			);
			const foreign = await request(
				base,
				'POST',
				`/api/snow/messages/${byLang.ja.id}`,
				{ jar: other, body: { action: 'approve' } },
			);
			expectStatus('cross-owner', foreign, 404);
			page = await request(base, 'GET', '/api/snow', {
				jar: other,
				origin: null,
			});
			assert.equal(page.json.weather.status, 'unknown_area');
			assert.equal(page.json.guests.length, 0);
			const noWarning = await request(base, 'POST', '/api/snow/drafts', {
				jar: other,
				body: { mode: 'jma' },
			});
			expectStatus('jma without warning', noWarning, 409);

			const staff = newCookieJar();
			expectStatus(
				'staff login',
				await request(base, 'POST', '/api/auth/login', {
					jar: staff,
					body: {
						email: 'staff@example.test',
						password: 'test-staff-password-1234',
					},
				}),
				200,
			);
			expectStatus(
				'staff forbidden',
				await request(base, 'GET', '/api/snow', {
					jar: staff,
					origin: null,
				}),
				403,
			);

			// Cross-origin POSTs are refused.
			const csrf = await request(
				base,
				'POST',
				'/api/snow/sample-guests',
				{ jar, body: {}, origin: 'https://evil.example' },
			);
			assert.equal(csrf.status, 403);
		} finally {
			await server.close();
			stub.close();
		}
	},
);
