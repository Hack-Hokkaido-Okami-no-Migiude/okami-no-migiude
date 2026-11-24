import type {
	PilotActionConfirmation,
	PilotConsentPurpose,
	PilotConsentScope,
} from '../../server/pilot/consent';
import type {
	PilotRosterCommand,
	PilotRosterFailureCode,
	PilotRosterState,
} from '../../server/pilot/roster';
import {
	applyPilotRosterCommand,
	emptyPilotRoster,
	isPilotSafetyCommand,
	pilotActiveConsent,
	pilotActiveSeats,
	pilotConsentReceipts,
	pilotConsentScope,
	pilotRosterVersionOf,
} from '../../server/pilot/roster';
import assert from 'node:assert/strict';
import { canUsePilotConsent } from '../../server/pilot/consent';
import test from 'node:test';

const at = '2026-11-24T00:00:00.000Z';
const ids = { businessId: 'synthetic-a', sessionId: 'session-a' } as const;
const localNotice = 'local-notice-1';
const external = {
	purpose: 'external-analysis',
	noticeVersion: 'analysis-notice-1',
	provider: 'synthetic-provider',
	providerRevision: 'provider-1',
} as const;
const localAction = { purpose: 'local-capture' } as const;

function apply(state: PilotRosterState, command: PilotRosterCommand) {
	const result = applyPilotRosterCommand(state, command);
	if (!result.ok) {
		assert.fail(`expected ${command.kind} to succeed: ${result.code}`);
	}
	return result;
}

function denied(
	state: PilotRosterState,
	command: PilotRosterCommand,
	code: PilotRosterFailureCode,
) {
	assert.deepEqual(applyPilotRosterCommand(state, command), { ok: false, code });
}

function addOwner(state: PilotRosterState) {
	return apply(state, {
		kind: 'add-seat',
		actorId: 'owner-a',
		seatActorId: 'owner-a',
		role: 'owner',
		label: 'オーナー',
		at,
	});
}

function addCoworker(state: PilotRosterState) {
	return apply(state, {
		kind: 'add-seat',
		actorId: 'owner-a',
		seatActorId: 'coworker-a',
		role: 'coworker',
		label: '同席者',
		at,
	});
}

function seatOf(state: PilotRosterState, actorId: string) {
	return pilotActiveSeats(state).find((seat) => seat.actorId === actorId)!;
}

function recordLocal(state: PilotRosterState, participantId: string, actorId: string) {
	return apply(state, {
		kind: 'record-consent',
		actorId,
		participantId,
		purpose: 'local-capture',
		noticeVersion: localNotice,
		provider: null,
		providerRevision: null,
		at,
	});
}

function scopeOf(state: PilotRosterState): PilotConsentScope {
	return pilotConsentScope(state, ids, localNotice);
}

function externalConfirmation(scope: PilotConsentScope): PilotActionConfirmation {
	return {
		businessId: scope.businessId,
		sessionId: scope.sessionId,
		rosterVersion: scope.rosterVersion,
		purpose: external.purpose,
		noticeVersion: external.noticeVersion,
		provider: external.provider,
		providerRevision: external.providerRevision,
		operationId: 'analysis-batch-7',
		confirmed: true,
	};
}

test('the owner bootstraps the roster; seats get stable server-assigned ids', () => {
	// The first seat must be an owner so an active owner always remains.
	denied(emptyPilotRoster(), {
		kind: 'add-seat',
		actorId: 'coworker-a',
		seatActorId: 'coworker-a',
		role: 'coworker',
		label: '同席者',
		at,
	}, 'not_permitted');

	const solo = addOwner(emptyPilotRoster());
	const seatId = solo.participantId!;
	assert.match(seatId, /^part_[0-9a-f-]{36}$/);
	assert.equal(solo.stop, true);
	assert.equal(solo.consent, null);
	assert.equal(pilotRosterVersionOf(solo.state), 'rt2');
	assert.deepEqual(
		pilotActiveSeats(solo.state).map((seat) => seat.role),
		['owner'],
	);

	// The same actor cannot hold a second seat.
	denied(solo.state, {
		kind: 'add-seat',
		actorId: 'owner-a',
		seatActorId: 'owner-a',
		role: 'coworker',
		label: 'ふせい',
		at,
	}, 'actor_already_seated');
});

test('each seat acknowledges for itself; the owner cannot consent for a coworker', () => {
	const owner = addOwner(emptyPilotRoster());
	const both = addCoworker(owner.state);
	const ownerSeat = seatOf(both.state, 'owner-a');
	const coworkerSeat = seatOf(both.state, 'coworker-a');

	denied(both.state, {
		kind: 'record-consent',
		actorId: 'owner-a',
		participantId: coworkerSeat.participantId,
		purpose: 'local-capture',
		noticeVersion: localNotice,
		provider: null,
		providerRevision: null,
		at,
	}, 'not_permitted');

	const ownerConsent = recordLocal(both.state, ownerSeat.participantId, 'owner-a');
	assert.equal(ownerConsent.stop, false);
	assert.equal(ownerConsent.consent?.status, 'active');
	assert.equal(ownerConsent.consent?.actorId, 'owner-a');
	assert.equal(
		pilotActiveConsent(ownerConsent.state, ownerSeat.participantId, 'local-capture')?.recordedAt,
		at,
	);

	const coworkerConsent = recordLocal(both.state, coworkerSeat.participantId, 'coworker-a');
	assert.equal(coworkerConsent.consent?.actorId, 'coworker-a');
});

test('the seam scope and receipts feed canUsePilotConsent exactly', () => {
	const owner = addOwner(emptyPilotRoster());
	const both = addCoworker(owner.state);
	const ownerSeat = seatOf(both.state, 'owner-a');
	const coworkerSeat = seatOf(both.state, 'coworker-a');
	const ownerLocal = recordLocal(both.state, ownerSeat.participantId, 'owner-a').state;
	const localState = recordLocal(
		ownerLocal,
		coworkerSeat.participantId,
		'coworker-a',
	).state;
	const ownerExternal = apply(localState, {
		kind: 'record-consent',
		actorId: 'owner-a',
		participantId: ownerSeat.participantId,
		...external,
		at,
	}).state;
	const state = apply(ownerExternal, {
		kind: 'record-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		...external,
		at,
	}).state;

	const scope = scopeOf(state);
	const receipts = pilotConsentReceipts(state, ids);
	assert.equal(
		canUsePilotConsent({ scope, action: localAction, receipts }),
		true,
	);
	assert.equal(
		canUsePilotConsent({
			scope,
			action: { ...external, operationId: 'analysis-batch-7' },
			receipts,
			confirmation: externalConfirmation(scope),
		}),
		true,
	);
	assert.equal(
		canUsePilotConsent({
			scope,
			action: { ...external, operationId: 'analysis-batch-8' },
			receipts,
			confirmation: externalConfirmation(scope),
		}),
		false,
	);
	assert.equal(
		canUsePilotConsent({
			scope,
			action: { ...external, operationId: 'analysis-batch-7' },
			receipts,
			confirmation: null,
		}),
		false,
	);
});

test('seat changes invalidate receipts until every seat re-acknowledges', () => {
	const solo = addOwner(emptyPilotRoster());
	const ownerSeat = seatOf(solo.state, 'owner-a');
	const soloState = recordLocal(solo.state, ownerSeat.participantId, 'owner-a').state;
	assert.equal(canUsePilotConsent({
		scope: scopeOf(soloState),
		action: localAction,
		receipts: pilotConsentReceipts(soloState, ids),
	}), true);

	// Adding a seat bumps the roster version, so the owner's receipt is inert.
	const both = addCoworker(soloState);
	assert.equal(canUsePilotConsent({
		scope: scopeOf(both.state),
		action: localAction,
		receipts: pilotConsentReceipts(both.state, ids),
	}), false);
	const reRecorded = recordLocal(both.state, ownerSeat.participantId, 'owner-a').state;
	const coworkerSeat = seatOf(reRecorded, 'coworker-a');
	const fullyConsented = recordLocal(
		reRecorded,
		coworkerSeat.participantId,
		'coworker-a',
	).state;
	assert.equal(canUsePilotConsent({
		scope: scopeOf(fullyConsented),
		action: localAction,
		receipts: pilotConsentReceipts(fullyConsented, ids),
	}), true);

	// Removing the coworker shrinks the roster and invalidates again.
	const removed = apply(fullyConsented, {
		kind: 'remove-seat',
		actorId: 'owner-a',
		participantId: coworkerSeat.participantId,
		at,
	});
	assert.equal(removed.stop, true);
	assert.equal(canUsePilotConsent({
		scope: scopeOf(removed.state),
		action: localAction,
		receipts: pilotConsentReceipts(removed.state, ids),
	}), false);
	const soloAgain = recordLocal(removed.state, ownerSeat.participantId, 'owner-a').state;
	assert.equal(canUsePilotConsent({
		scope: scopeOf(soloAgain),
		action: localAction,
		receipts: pilotConsentReceipts(soloAgain, ids),
	}), true);
});

test('revoke is own-purpose only, durable, idempotent, and always signals stop', () => {
	const owner = addOwner(emptyPilotRoster());
	const both = addCoworker(owner.state);
	const ownerSeat = seatOf(both.state, 'owner-a');
	const coworkerSeat = seatOf(both.state, 'coworker-a');
	// Local scope precedes intake; external receipts only then matter.
	const ownerLocal = recordLocal(both.state, ownerSeat.participantId, 'owner-a').state;
	const localState = recordLocal(
		ownerLocal,
		coworkerSeat.participantId,
		'coworker-a',
	).state;
	const ownerExternal = apply(localState, {
		kind: 'record-consent',
		actorId: 'owner-a',
		participantId: ownerSeat.participantId,
		...external,
		at,
	}).state;
	const consented = apply(ownerExternal, {
		kind: 'record-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		...external,
		at,
	}).state;
	const action = { ...external, operationId: 'analysis-batch-7' } as const;
	const scope = scopeOf(consented);
	assert.equal(canUsePilotConsent({
		scope,
		action,
		receipts: pilotConsentReceipts(consented, ids),
		confirmation: externalConfirmation(scope),
	}), true);

	denied(consented, {
		kind: 'revoke-consent',
		actorId: 'owner-a',
		participantId: coworkerSeat.participantId,
		purpose: 'external-analysis',
		at,
	}, 'not_permitted');

	const revoked = apply(consented, {
		kind: 'revoke-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		purpose: 'external-analysis',
		at,
	});
	assert.equal(revoked.stop, true);
	assert.equal(revoked.consent, null);
	assert.equal(pilotActiveConsent(revoked.state, coworkerSeat.participantId, 'external-analysis'), null);
	const row = revoked.state.consents.find((entry) =>
		entry.participantId === coworkerSeat.participantId
		&& entry.purpose === 'external-analysis');
	assert.equal(row?.status, 'revoked');
	assert.equal(row?.revokedAt, at);
	assert.equal(revoked.rev, consented.rev + 1);
	const revokedScope = scopeOf(revoked.state);
	assert.equal(canUsePilotConsent({
		scope: revokedScope,
		action,
		receipts: pilotConsentReceipts(revoked.state, ids),
		confirmation: externalConfirmation(revokedScope),
	}), false);

	// Repeating the revoke changes nothing but still signals stop.
	const again = apply(revoked.state, {
		kind: 'revoke-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		purpose: 'external-analysis',
		at,
	});
	assert.equal(again.state, revoked.state);
	assert.equal(again.rev, revoked.rev);
	assert.equal(again.stop, true);

	// Revoking a purpose that was never granted also only signals stop.
	const neverGranted = apply(consented, {
		kind: 'revoke-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		purpose: 'live-voice',
		at,
	});
	assert.equal(neverGranted.state, consented);
	assert.equal(neverGranted.stop, true);
});

test('removed seats keep their id; the same actor returns on a fresh seat', () => {
	const owner = addOwner(emptyPilotRoster());
	const both = addCoworker(owner.state);
	const coworkerSeat = seatOf(both.state, 'coworker-a');
	const removed = apply(both.state, {
		kind: 'remove-seat',
		actorId: 'owner-a',
		participantId: coworkerSeat.participantId,
		at,
	});

	denied(removed.state, {
		kind: 'record-consent',
		actorId: 'coworker-a',
		participantId: coworkerSeat.participantId,
		purpose: 'local-capture',
		noticeVersion: localNotice,
		provider: null,
		providerRevision: null,
		at,
	}, 'not_found');

	const returned = addCoworker(removed.state);
	const newSeat = seatOf(returned.state, 'coworker-a');
	assert.notEqual(newSeat.participantId, coworkerSeat.participantId);
	assert.equal(
		pilotConsentReceipts(returned.state, ids).some(
			(receipt) => receipt.participantId === newSeat.participantId,
		),
		false,
	);
	assert.equal(pilotActiveSeats(removed.state).length, 1);
	assert.equal(
		removed.state.seats.some((seat) => seat.removedAt === at),
		true,
	);
});

test('the last owner cannot be removed and unknown seats deny', () => {
	const solo = addOwner(emptyPilotRoster());
	const ownerSeat = seatOf(solo.state, 'owner-a');
	denied(solo.state, {
		kind: 'remove-seat',
		actorId: 'owner-a',
		participantId: ownerSeat.participantId,
		at,
	}, 'last_owner');
	denied(solo.state, {
		kind: 'remove-seat',
		actorId: 'owner-a',
		participantId: 'part_00000000-0000-4000-8000-000000000000',
		at,
	}, 'not_found');
	denied(solo.state, {
		kind: 'remove-seat',
		actorId: 'coworker-a',
		participantId: ownerSeat.participantId,
		at,
	}, 'not_permitted');
});

test('malformed commands deny without touching the roster', () => {
	const solo = addOwner(emptyPilotRoster());
	const ownerSeat = seatOf(solo.state, 'owner-a');
	const bogus = 'not-a-purpose' as PilotConsentPurpose;
	for (const command of [
		{ kind: 'add-seat', actorId: 'owner-a', seatActorId: 'coworker-b', role: 'coworker', label: '   ', at },
		{ kind: 'add-seat', actorId: 'owner-a', seatActorId: 'coworker-b', role: 'coworker', label: 'あ'.repeat(41), at },
		{ kind: 'add-seat', actorId: 'owner-a', seatActorId: 'coworker-b', role: 'coworker', label: 'ラベル\n改行', at },
		{ kind: 'add-seat', actorId: 'bad actor', seatActorId: 'coworker-b', role: 'coworker', label: 'ラベル', at },
		{ kind: 'add-seat', actorId: 'owner-a', seatActorId: 'bad seat', role: 'coworker', label: 'ラベル', at },
		{ kind: 'record-consent', actorId: 'owner-a', participantId: ownerSeat.participantId, purpose: bogus, noticeVersion: localNotice, provider: null, providerRevision: null, at },
		{ kind: 'record-consent', actorId: 'owner-a', participantId: ownerSeat.participantId, purpose: 'local-capture', noticeVersion: localNotice, provider: 'synthetic-provider', providerRevision: null, at },
		{ kind: 'record-consent', actorId: 'owner-a', participantId: ownerSeat.participantId, purpose: 'live-voice', noticeVersion: localNotice, provider: null, providerRevision: null, at },
		{ kind: 'record-consent', actorId: 'owner-a', participantId: ownerSeat.participantId, purpose: 'live-voice', noticeVersion: localNotice, provider: 'synthetic-provider', providerRevision: 'provider-1', at: 'not-a-date' },
	] as PilotRosterCommand[]) {
		denied(solo.state, command, 'invalid_input');
	}
	const untouched = applyPilotRosterCommand(solo.state, {
		kind: 'unknown-command',
	} as unknown as PilotRosterCommand);
	assert.deepEqual(untouched, { ok: false, code: 'invalid_input' });
	assert.equal(pilotRosterVersionOf(solo.state), 'rt2');
	assert.equal(solo.state.rev, 2);
});

test('only the revoke is a safety command that bypasses the ordinary revision', () => {
	assert.equal(isPilotSafetyCommand({
		kind: 'revoke-consent',
		actorId: 'owner-a',
		participantId: 'part_00000000-0000-4000-8000-000000000000',
		purpose: 'local-capture',
		at,
	}), true);
	for (const command of [
		{ kind: 'add-seat', actorId: 'owner-a', seatActorId: 'coworker-a', role: 'coworker', label: 'ラベル', at },
		{ kind: 'remove-seat', actorId: 'owner-a', participantId: 'part_00000000-0000-4000-8000-000000000000', at },
		{ kind: 'record-consent', actorId: 'owner-a', participantId: 'part_00000000-0000-4000-8000-000000000000', purpose: 'local-capture', noticeVersion: localNotice, provider: null, providerRevision: null, at },
	] as PilotRosterCommand[]) {
		assert.equal(isPilotSafetyCommand(command), false);
	}
});
