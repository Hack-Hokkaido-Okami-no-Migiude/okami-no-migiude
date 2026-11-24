import {
	canAccessPilot,
	checkPilotPublicRoute,
} from '../../server/pilot/access';
import type { PilotAccessRequest } from '../../server/pilot/access';
import assert from 'node:assert/strict';
import test from 'node:test';

const capture = {
	mode: 'private-capture',
	dataKind: 'pilot',
	capability: 'capture',
	businessId: 'synthetic-a',
	principal: { actorId: 'owner-a', businessId: 'synthetic-a', role: 'owner' },
} satisfies PilotAccessRequest;

const route = { method: 'GET', pathname: '/quests' };

test('private capture requires the exact verified business', () => {
	assert.equal(canAccessPilot(capture), true);
	assert.equal(
		canAccessPilot({ ...capture, businessId: 'synthetic-b' }),
		false,
	);
	assert.equal(canAccessPilot({ ...capture, principal: null }), false);
	assert.equal(
		canAccessPilot({
			...capture,
			principal: { ...capture.principal, actorId: '' },
		}),
		false,
	);
});

test('modes do not permit private capture or release outside their lane', () => {
	assert.equal(canAccessPilot({ ...capture, mode: 'public-demo' }), false);
	assert.equal(canAccessPilot({ ...capture, mode: 'fixture-local' }), false);
	assert.equal(canAccessPilot({ ...capture, dataKind: 'fixture' }), false);
	assert.equal(
		canAccessPilot({ ...capture, capability: 'owner-release-route' }),
		false,
	);
	assert.equal(canAccessPilot({ ...capture, mode: 'real-pilot' }), false);
	assert.equal(
		canAccessPilot({
			...capture,
			mode: 'unknown' as PilotAccessRequest['mode'],
		}),
		false,
	);
	assert.equal(
		canAccessPilot({
			...capture,
			mode: 'real-pilot',
			realPilotEnabled: true,
		}),
		true,
	);
	assert.equal(
		canAccessPilot({
			...capture,
			mode: 'fixture-local',
			dataKind: 'fixture',
			capability: 'fixture-workbench',
		}),
		true,
	);
});

test('real release-route capabilities do not inherit other roles', () => {
	const pilot = {
		...capture,
		mode: 'real-pilot',
		realPilotEnabled: true,
	} as const;
	assert.equal(
		canAccessPilot({ ...pilot, capability: 'owner-release-route' }),
		true,
	);
	assert.equal(
		canAccessPilot({ ...pilot, capability: 'reviewer-release-route' }),
		false,
	);
	assert.equal(
		canAccessPilot({ ...pilot, capability: 'admin-release-route' }),
		false,
	);
	assert.equal(
		canAccessPilot({
			...pilot,
			capability: 'reviewer-release-route',
			principal: {
				...pilot.principal,
				actorId: 'reviewer-a',
				role: 'reviewer',
			},
		}),
		true,
	);
});

test('public board, assets, and API paths require their exact methods', () => {
	const demo = { mode: 'public-demo' } as const;
	const quest = '/api/quests/qst_00000000-0000-4000-8000-000000000001';
	assert.equal(checkPilotPublicRoute({ ...demo, ...route }), 'board');
	assert.equal(
		checkPilotPublicRoute({
			...demo,
			method: 'GET',
			pathname: '/favicon.ico',
		}),
		'asset',
	);
	assert.equal(
		checkPilotPublicRoute({
			...demo,
			method: 'GET',
			pathname: '/api/quests',
		}),
		'list',
	);
	assert.equal(
		checkPilotPublicRoute({ ...demo, method: 'GET', pathname: quest }),
		'detail',
	);
	assert.equal(
		checkPilotPublicRoute({
			...demo,
			method: 'POST',
			pathname: `${quest}/claim`,
		}),
		'claim',
	);
	for (const [method, pathname] of [
		['HEAD', '/quests'],
		['get', '/quests'],
		['GET', '/quests/'],
		['GET', '/quests?preview=1'],
		['GET', '/workbench'],
		['GET', '/api/clients'],
		['GET', '/_nuxt/unknown.js'],
		['GET', `${quest}/claim`],
		['POST', quest],
		['POST', '/api/quests'],
		['GET', '/api/quests/not-a-quest'],
		['GET', `${quest}%2fclaim`],
		['GET', `${quest}\n`],
	] as const) {
		assert.equal(
			checkPilotPublicRoute({ ...demo, method, pathname }),
			null,
			`${method} ${pathname}`,
		);
	}
});

test('the real board is deployment-gated and real claims require a same-business engineer', () => {
	const pilot = { mode: 'real-pilot', realPilotEnabled: true } as const;
	assert.equal(
		checkPilotPublicRoute({ ...route, mode: 'private-capture' }),
		null,
	);
	assert.equal(checkPilotPublicRoute({ ...route, mode: 'real-pilot' }), null);
	assert.equal(checkPilotPublicRoute({ ...route, ...pilot }), 'board');
	const claim = {
		...pilot,
		method: 'POST',
		pathname: '/api/quests/qst_00000000-0000-4000-8000-000000000001/claim',
		businessId: 'synthetic-a',
		principal: capture.principal,
	};
	assert.equal(checkPilotPublicRoute(claim), null);
	assert.equal(checkPilotPublicRoute({ ...claim, principal: null }), null);
	const engineer = {
		actorId: 'engineer-a',
		businessId: 'synthetic-a',
		role: 'engineer',
	} as const;
	assert.equal(
		checkPilotPublicRoute({
			...claim,
			principal: engineer,
			businessId: 'synthetic-b',
		}),
		null,
	);
	assert.equal(
		checkPilotPublicRoute({ ...claim, principal: engineer }),
		'claim',
	);
});
