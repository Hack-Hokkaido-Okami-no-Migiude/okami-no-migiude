import {
	type PilotIngressRequest,
	readNodePilotRequest,
} from '../../server/pilot/deployment';
import { createHash, randomBytes } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import assert from 'node:assert/strict';
import { createPilotIngress } from '../../server/pilot/ingress';
import test from 'node:test';

const origin = 'https://pilot.example.invalid';
const host = 'pilot.example.invalid';
const ownerToken = randomBytes(32).toString('base64url');
const reviewerToken = randomBytes(32).toString('base64url');
const adminToken = randomBytes(32).toString('base64url');
const engineerToken = randomBytes(32).toString('base64url');
const businessId = 'cli_synthetic_a';
const session = `/api/clients/${businessId}/sessions/ses_fixturefree`;
const credential = (actorId: string, role: string, token: string) => ({
	actorId,
	businessId,
	role,
	tokenSha256: createHash('sha256').update(token, 'ascii').digest('hex'),
});
const rows = [
	credential('owner-a', 'owner', ownerToken),
	credential('reviewer-a', 'reviewer', reviewerToken),
	credential('admin-a', 'admin', adminToken),
	credential('engineer-a', 'engineer', engineerToken),
];
const env = {
	SHIMA_MODE: 'private-capture',
	SHIMA_PILOT_ORIGIN: origin,
	SHIMA_PILOT_BUSINESS_ID: businessId,
	SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify(rows),
};
const read = {
	transport: 'https',
	remoteAddress: '127.0.0.1',
	method: 'GET',
	target: session,
	rawHeaders: ['Host', host],
} as const;
const write = {
	...read,
	method: 'POST',
	rawHeaders: ['Host', host, 'Origin', origin],
} as const;

test('a provisioned token establishes an opaque cookie and the exact private principal', () => {
	const ingress = createPilotIngress(env);
	const issued = ingress.issuePrivateCookie(write, ownerToken);
	assert.ok(issued);
	assert.match(
		issued,
		/^__Host-shima-pilot=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/,
	);
	assert.ok(!issued.includes(ownerToken));
	const cookie = issued.split(';')[0]!;
	assert.deepEqual(
		ingress.decide({
			...read,
			rawHeaders: [...read.rawHeaders, 'Cookie', cookie],
		}),
		{
			kind: 'private',
			serialization: 'private',
			cacheControl: 'no-store',
			principal: { actorId: 'owner-a', businessId, role: 'owner' },
		},
	);
	assert.equal(
		ingress.decide({
			...read,
			target: session.replace(businessId, 'cli_synthetic_b'),
			rawHeaders: [...read.rawHeaders, 'Cookie', cookie],
		}).kind,
		'deny',
	);
	assert.equal(ingress.issuePrivateCookie(write, rows[0]!.tokenSha256), null);
	assert.equal(
		ingress.issuePrivateCookie(
			write,
			randomBytes(32).toString('base64url'),
		),
		null,
	);
});

const notFound = {
	kind: 'deny',
	status: 404,
	cacheControl: 'no-store',
	body: { error: { code: 'not_found', message: 'Not found.' } },
};

function signed(request: PilotIngressRequest, cookie: string) {
	return {
		...request,
		rawHeaders: [...request.rawHeaders, 'Cookie', cookie],
	};
}

function openSession(
	ingress: ReturnType<typeof createPilotIngress>,
	token: string,
) {
	const cookie = ingress.issuePrivateCookie(write, token)?.split(';')[0];
	assert.ok(cookie);
	return cookie;
}

test('Node adaptation preserves the raw target and uses the real socket for TLS', () => {
	for (const socket of [new Socket(), new TLSSocket(new Socket())]) {
		try {
			const req = new IncomingMessage(socket);
			req.method = 'GET';
			req.url = '/workbench/%2e?foo=bar';
			req.rawHeaders = [
				'hOSt',
				host,
				'Upgrade',
				'websocket',
				'X-Forwarded-Proto',
				'https',
			];
			assert.deepEqual(readNodePilotRequest(req), {
				transport: socket instanceof TLSSocket ? 'https' : 'http',
				remoteAddress: undefined,
				method: 'GET',
				target: req.url,
				rawHeaders: req.rawHeaders,
			});
		} finally {
			socket.destroy();
		}
	}
});

test('the process-local cookie expires server-side at eight hours', (t) => {
	const now = t.mock.method(Date, 'now', () => 0);
	const ingress = createPilotIngress(env);
	const cookie = openSession(ingress, ownerToken);
	assert.equal(ingress.decide(signed(read, cookie)).kind, 'private');
	now.mock.mockImplementation(() => 8 * 60 * 60 * 1000);
	assert.deepEqual(ingress.decide(signed(read, cookie)), notFound);
});

const realEnv = {
	...env,
	SHIMA_MODE: 'real-pilot',
	SHIMA_REAL_PILOT_ENABLED: 'true',
};
const pkg = `${session}/shima/packages/pkg_synthetic`;
const quest = '/api/quests/qst_00000000-0000-4000-8000-000000000001';

test('remote, spoofed and upgraded fixture requests do not cross the default loopback boundary', () => {
	const ingress = createPilotIngress({});
	const local = {
		...read,
		transport: 'http',
		rawHeaders: ['Host', '127.0.0.1:3000'],
	} as const;
	for (const [method, target] of [
		['GET', '/'],
		['GET', '/workbench'],
		['GET', '/api/clients'],
		['POST', '/api/demo/hotel'],
		['GET', '/quests'],
		['GET', quest],
		['POST', `${quest}/claim`],
		['POST', `${pkg}/publish`],
	] as const) {
		assert.equal(
			ingress.decide({ ...local, method, target }).kind,
			'fixture',
		);
	}
	for (const input of [
		{ ...local, remoteAddress: '192.0.2.2' },
		{ ...local, rawHeaders: ['Host', host] },
		{
			...local,
			rawHeaders: [
				...local.rawHeaders,
				'Origin',
				'https://foreign.example.invalid',
			],
		},
		{
			...local,
			rawHeaders: [...local.rawHeaders, 'X-Forwarded-For', '127.0.0.1'],
		},
		{ ...local, upgrade: 'websocket' },
		{ ...local, method: 'HEAD', target: '/quests' },
		{ ...local, method: 'POST', target: `${pkg}/pilot/publish` },
	] as const) {
		assert.deepEqual(ingress.decide(input), notFound);
	}
	assert.equal(
		ingress.issuePrivateCookie({ ...local, method: 'POST' }, ownerToken),
		null,
	);
});

test('unprovisioned deployments never fall back to fixture or serve even a landing', () => {
	for (const config of [
		{ SHIMA_MODE: '' },
		{ SHIMA_MODE: 'public-demo' },
		{ SHIMA_MODE: 'private-capture' },
		{ ...realEnv, SHIMA_REAL_PILOT_ENABLED: undefined },
		{ ...realEnv, SHIMA_REAL_PILOT_ENABLED: 'TRUE' },
		{ ...env, SHIMA_PILOT_ORIGIN: `http://${host}` },
		{ ...env, SHIMA_PILOT_ORIGIN: `${origin}/` },
		{ ...env, SHIMA_PILOT_ORIGIN: `${origin}:443` },
		{ ...env, SHIMA_PILOT_ORIGIN: `https://user:pass@${host}` },
		{ ...env, SHIMA_PILOT_BUSINESS_ID: `${businessId}\n` },
		{ ...env, SHIMA_PILOT_PRINCIPALS_JSON: '{' },
		{ ...env, SHIMA_PILOT_PRINCIPALS_JSON: '[]' },
		{
			...env,
			SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
				rows[0],
				{ ...rows[1], actorId: 'owner-a' },
			]),
		},
		{
			...env,
			SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
				rows[0],
				{ ...rows[1], tokenSha256: rows[0]!.tokenSha256 },
			]),
		},
		{
			...env,
			SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
				{ ...rows[0], businessId: 'cli_synthetic_b' },
			]),
		},
		{
			...env,
			SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
				{ ...rows[0], tokenSha256: ownerToken },
			]),
		},
		{
			...env,
			SHIMA_PILOT_PRINCIPALS_JSON: JSON.stringify([
				{ ...rows[0], role: 'superuser' },
			]),
		},
	]) {
		const ingress = createPilotIngress(config);
		assert.deepEqual(ingress.decide({ ...read, target: '/' }), notFound);
		assert.equal(ingress.issuePrivateCookie(write, ownerToken), null);
	}
});

test('private writes and cookie issuance require exact Host, HTTPS and same Origin before dispatch', () => {
	const ingress = createPilotIngress(env);
	const sessionCookie = openSession(ingress, ownerToken);
	for (const input of [
		{ ...signed(write, sessionCookie), transport: 'http' },
		{
			...signed(write, sessionCookie),
			rawHeaders: [
				...write.rawHeaders,
				'Host',
				host,
				'Cookie',
				sessionCookie,
			],
		},
		{
			...signed(write, sessionCookie),
			rawHeaders: [
				'Host',
				`${host}:443`,
				'Origin',
				origin,
				'Cookie',
				sessionCookie,
			],
		},
		{
			...signed(write, sessionCookie),
			rawHeaders: ['Host', host, 'Cookie', sessionCookie],
		},
		{
			...signed(write, sessionCookie),
			rawHeaders: [
				'Host',
				host,
				'Origin',
				'null',
				'Cookie',
				sessionCookie,
			],
		},
		{
			...signed(write, sessionCookie),
			rawHeaders: [
				...write.rawHeaders,
				'origin',
				origin,
				'Cookie',
				sessionCookie,
			],
		},
		{
			...signed(write, sessionCookie),
			rawHeaders: [
				...write.rawHeaders,
				'Forwarded',
				`host=${host};proto=https`,
				'Cookie',
				sessionCookie,
			],
		},
	] as const) {
		assert.equal(ingress.canIssuePrivateCookie(input), false);
		assert.equal(ingress.issuePrivateCookie(input, ownerToken), null);
		assert.deepEqual(
			ingress.decide({ ...input, target: `${session}/analyze` }),
			notFound,
		);
	}
	assert.equal(ingress.canIssuePrivateCookie(write), true);
	assert.equal(
		ingress.canIssuePrivateCookie({
			...write,
			target: `${write.target}?not-a-login-body=1`,
		}),
		false,
	);
	assert.equal(
		ingress.decide({
			...signed(write, sessionCookie),
			target: `${session}/analyze`,
		}).kind,
		'private',
	);
});

test('identity assertion headers, fixture credentials, duplicate cookies and previous sessions confer no access', () => {
	const ingress = createPilotIngress(env);
	const cookie = openSession(ingress, ownerToken);
	for (const rawHeaders of [
		[
			...read.rawHeaders,
			'X-Actor-Id',
			'owner-a',
			'X-Role',
			'owner',
			'X-Business-Id',
			businessId,
		],
		[...read.rawHeaders, 'Authorization', `Bearer ${ownerToken}`],
		[...read.rawHeaders, 'Cookie', `__Host-shima-pilot=${ownerToken}`],
		[...read.rawHeaders, 'Cookie', 'shima_demo_claimant=test'],
		[...read.rawHeaders, 'Cookie', `${cookie}; ${cookie}`],
		[...read.rawHeaders, 'Cookie', cookie, 'cookie', cookie],
	]) {
		assert.deepEqual(ingress.decide({ ...read, rawHeaders }), notFound);
	}
	const fresh = openSession(ingress, ownerToken);
	assert.notEqual(cookie, fresh);
	assert.deepEqual(ingress.decide(signed(read, cookie)), notFound);
	assert.deepEqual(
		createPilotIngress(env).decide(signed(read, fresh)),
		notFound,
	);
	assert.equal(ingress.issuePrivateCookie(write, engineerToken), null);
});

test('private serialization is distinct from generic landing and exact static files', () => {
	const chunk = '/_nuxt/entry.XYZ.js';
	const ingress = createPilotIngress(env, [
		chunk,
		'/_nuxt/entry.XYZ.js.map',
		'/_nuxt/_payload.js',
		'/workbench/_payload.json',
	]);
	const owner = openSession(ingress, ownerToken);
	assert.deepEqual(ingress.decide({ ...read, target: '/' }), {
		kind: 'landing',
		serialization: 'generic-only',
		cacheControl: 'no-store',
	});
	assert.equal(
		ingress.decide({ ...signed(read, owner), target: '/' }).kind,
		'private',
	);
	assert.equal(
		ingress.decide({ ...signed(read, owner), target: '/workbench' }).kind,
		'private',
	);
	assert.deepEqual(
		ingress.decide({ ...read, target: '/workbench' }),
		notFound,
	);
	for (const target of [chunk, '/favicon.ico']) {
		assert.deepEqual(ingress.decide({ ...read, target }), {
			kind: 'asset',
			serialization: 'static-only',
		});
	}
	for (const target of [
		'/_payload.json',
		'/workbench/_payload.json',
		'/_nuxt/_payload.js',
		'/_nuxt/entry.XYZ.js.map',
		'/_nuxt/other.js',
		'/api/clients',
		'/api/demo/hotel',
		'/quests',
		'/api/quests',
		quest,
		`${session}/shima/map/`,
		`${session}/%73hima/map`,
		`${session}/../${businessId}/sessions/ses_fixturefree`,
		`https://${host}${session}`,
		`${session}#hash`,
		`${session}\n`,
	]) {
		assert.deepEqual(
			ingress.decide({ ...signed(read, owner), target }),
			notFound,
		);
	}
	for (const method of ['HEAD', 'OPTIONS', 'get', 'POST']) {
		assert.deepEqual(
			ingress.decide({ ...signed(write, owner), method, target: chunk }),
			notFound,
		);
		assert.deepEqual(
			ingress.decide({
				...signed(write, owner),
				method,
				target: `${session}/shima/map`,
			}),
			notFound,
		);
	}
});

test('reviewer, creator and admin permissions remain distinct in enabled real-pilot mode', () => {
	const ingress = createPilotIngress(realEnv);
	const owner = openSession(ingress, ownerToken);
	const reviewer = openSession(ingress, reviewerToken);
	const admin = openSession(ingress, adminToken);
	for (const [action, allowed] of [
		['preview', [reviewer]],
		['review', [reviewer]],
		['approve', [owner]],
		['permit', [admin]],
		['publish', [admin]],
		['withdraw', [owner, admin]],
	] as const) {
		for (const cookie of [owner, reviewer, admin]) {
			const request = {
				...signed(write, cookie),
				target: `${pkg}/pilot/${action}`,
			};
			assert.equal(
				ingress.decide(request).kind,
				allowed.includes(cookie) ? 'private' : 'deny',
			);
			assert.deepEqual(
				ingress.decide({
					...request,
					target: request.target.replace(
						businessId,
						'cli_synthetic_b',
					),
				}),
				notFound,
			);
		}
	}
	assert.equal(ingress.decide(signed(read, reviewer)).kind, 'private');
	assert.deepEqual(ingress.decide(signed(read, admin)), notFound);
	assert.deepEqual(
		ingress.decide({ ...signed(write, owner), target: `${pkg}/publish` }),
		notFound,
	);
	assert.deepEqual(
		ingress.decide({ ...signed(write, admin), target: `${quest}/claim` }),
		notFound,
	);
	assert.deepEqual(ingress.decide({ ...read, target: '/quests' }), notFound);
});

test('private capture disables release and requires owner for roster changes', () => {
	const ingress = createPilotIngress(env);
	const reviewer = openSession(ingress, reviewerToken);
	const owner = openSession(ingress, ownerToken);
	for (const suffix of [
		'/complete',
		'/pilot/preview',
		'/pilot/publish',
		'/publish',
	]) {
		assert.deepEqual(
			ingress.decide({
				...signed(write, owner),
				target: `${pkg}${suffix}`,
			}),
			notFound,
		);
	}
	const roster = { ...write, target: `${session}/shima/participants` };
	assert.deepEqual(
		ingress.decide({
			...roster,
			rawHeaders: signed(write, reviewer).rawHeaders,
		}),
		notFound,
	);
	assert.equal(
		ingress.decide({
			...roster,
			rawHeaders: signed(write, owner).rawHeaders,
		}).kind,
		'private',
	);
});

test('streams require a same-origin authenticated WebSocket upgrade, not a claimed header', () => {
	const ingress = createPilotIngress(env);
	const owner = openSession(ingress, ownerToken);
	const target = `${session}/shima/interview/stream`;
	const rawHeaders = [
		...signed(write, owner).rawHeaders,
		'Upgrade',
		'websocket',
	];
	assert.deepEqual(ingress.decide({ ...read, target, rawHeaders }), notFound);
	assert.deepEqual(
		ingress.decide({
			...signed(read, owner),
			target,
			upgrade: 'websocket',
		}),
		notFound,
	);
	assert.deepEqual(
		ingress.decide({
			...read,
			target: session,
			rawHeaders,
			upgrade: 'websocket',
		}),
		notFound,
	);
	assert.equal(
		ingress.decide({ ...read, target, rawHeaders, upgrade: 'websocket' })
			.kind,
		'private',
	);
});
