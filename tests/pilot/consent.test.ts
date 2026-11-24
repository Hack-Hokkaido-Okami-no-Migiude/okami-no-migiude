import type {
	PilotActionConfirmation,
	PilotConsentReceipt,
	PilotConsentRequest,
} from '../../server/pilot/consent';
import assert from 'node:assert/strict';
import { canUsePilotConsent } from '../../server/pilot/consent';
import test from 'node:test';

const scope = {
	businessId: 'synthetic-a',
	sessionId: 'session-a',
	rosterVersion: 'roster-v1',
	localNoticeVersion: 'local-v1',
	roster: [
		{ participantId: 'person-1', actorId: 'seat-1' },
		{ participantId: 'person-2', actorId: 'seat-2' },
	],
} as const;
const { businessId, sessionId, rosterVersion } = scope;
const binding = { businessId, sessionId, rosterVersion };
const action = {
	purpose: 'external-analysis',
	provider: 'synthetic-provider',
	providerRevision: 'provider-v1',
	noticeVersion: 'analysis-v1',
	operationId: 'revision-7',
} as const;
const confirmation = {
	...binding,
	...action,
	confirmed: true,
} satisfies PilotActionConfirmation;
const receipts = scope.roster.flatMap((participant): PilotConsentReceipt[] => {
	const receipt = {
		...binding,
		...participant,
		recordedAt: '2026-11-01T00:00:00.000Z',
		status: 'active',
	} as const;
	return [
		{
			...receipt,
			purpose: 'local-capture',
			noticeVersion: scope.localNoticeVersion,
			provider: null,
			providerRevision: null,
		},
		{
			...receipt,
			purpose: action.purpose,
			noticeVersion: action.noticeVersion,
			provider: action.provider,
			providerRevision: action.providerRevision,
		},
	];
});
const external = {
	scope,
	action,
	receipts,
	confirmation,
} satisfies PilotConsentRequest;
const local = {
	scope,
	action: { purpose: 'local-capture' },
	receipts,
} satisfies PilotConsentRequest;

test('a synthetic roster with current individual receipts and an exact external confirmation can proceed', () => {
	assert.equal(canUsePilotConsent(local), true);
	assert.equal(canUsePilotConsent(external), true);
});

test('all represented participants need their own receipt for the exact purpose', () => {
	assert.equal(
		canUsePilotConsent({ ...local, receipts: receipts.slice(0, 2) }),
		false,
	);
	const withoutSecondExternal = receipts.slice(0, 3);
	assert.equal(
		canUsePilotConsent({ ...external, receipts: withoutSecondExternal }),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			receipts: receipts.map((r) =>
				r.participantId === 'person-2' && r.purpose === action.purpose ?
					{ ...r, actorId: 'seat-1' }
				:	r,
			),
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			receipts: receipts.map((r) =>
				r.purpose === action.purpose ?
					{ ...r, purpose: 'recorded-stt' }
				:	r,
			),
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({ ...local, scope: { ...scope, roster: [] } }),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...local,
			scope: { ...scope, roster: [scope.roster[0]] },
			receipts: [],
		}),
		false,
	);
});

test('stale notice, provider, business, session, or roster bindings deny', () => {
	assert.equal(
		canUsePilotConsent({
			...external,
			scope: { ...scope, localNoticeVersion: 'local-v2' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			scope: { ...scope, businessId: 'synthetic-b' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			scope: { ...scope, sessionId: 'session-b' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...local,
			scope: { ...scope, rosterVersion: 'roster-v2' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...local,
			scope: {
				...scope,
				roster: [
					{ ...scope.roster[0], actorId: 'new-seat-1' },
					scope.roster[1],
				],
			},
		}),
		false,
	);
	for (const changedAction of [
		{ ...action, noticeVersion: 'analysis-v2' },
		{ ...action, provider: 'another-synthetic-provider' },
		{ ...action, providerRevision: 'provider-v2' },
	]) {
		assert.equal(
			canUsePilotConsent({
				...external,
				action: changedAction,
				confirmation: { ...confirmation, ...changedAction },
			}),
			false,
		);
	}
});

test('a revoked local or external receipt denies without fallback to an active duplicate', () => {
	for (const purpose of ['local-capture', action.purpose] as const) {
		const current = receipts.map((r) =>
			r.purpose === purpose && r.participantId === 'person-2' ?
				{ ...r, status: 'revoked' as const }
			:	r,
		);
		assert.equal(
			canUsePilotConsent({ ...external, receipts: current }),
			false,
		);
		assert.equal(
			canUsePilotConsent({
				...external,
				receipts: [
					...receipts,
					...current.filter((r) => r.status === 'revoked'),
				],
			}),
			false,
		);
	}
});

test('each external action needs its own positive confirmation', () => {
	assert.equal(
		canUsePilotConsent({ ...external, confirmation: null }),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			action: { ...action, operationId: 'revision-8' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			confirmation: { ...confirmation, provider: 'old-provider' },
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			...external,
			confirmation: { ...confirmation, rosterVersion: 'roster-v0' },
		}),
		false,
	);
});
