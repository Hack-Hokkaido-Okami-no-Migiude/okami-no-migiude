// Epoch registry tests: one bounded active epoch per scope, typed conflict on
// double acquisition, release-and-reacquire, independent scopes, lifetime
// auto-release, and injectable ids and clock. Fully in-process.
import { DEFAULT_EPOCH_LIFETIME_MS, VoiceEpochRegistry } from '../../server/voice/epoch';
import { FakeClock } from './helpers/fake-clock';
import { VoiceError } from '../../server/voice/errors';
import assert from 'node:assert/strict';
import test from 'node:test';

test('a scope holds exactly one active epoch; a second acquire conflicts', () => {
	const registry = new VoiceEpochRegistry();
	const first = registry.acquire('cli_a/ses_1');
	assert.equal(registry.activeEpochId('cli_a/ses_1'), first.id);
	assert.throws(
		() => registry.acquire('cli_a/ses_1'),
		(error: unknown) =>
			error instanceof VoiceError
			&& error.code === 'epoch_active'
			&& /already active/.test(error.message),
	);
	// Other scopes are independent.
	const other = registry.acquire('cli_a/ses_2');
	assert.notEqual(other.id, first.id);
	assert.notEqual(other.scopeKey, first.scopeKey);
});

test('release frees the scope; release is idempotent and keys stay stable', () => {
	const registry = new VoiceEpochRegistry();
	const epoch = registry.acquire('cli_a/ses_1', { idFactory: () => 'ep_fixed' });
	assert.equal(epoch.id, 'ep_fixed');
	epoch.release();
	epoch.release();
	assert.equal(registry.activeEpochId('cli_a/ses_1'), null);
	const again = registry.acquire('cli_a/ses_1', { idFactory: () => 'ep_next' });
	assert.equal(again.id, 'ep_next');
});

test('an epoch that is never released is force-released at the bounded lifetime', () => {
	const clock = new FakeClock();
	const registry = new VoiceEpochRegistry();
	const epoch = registry.acquire('cli_a/ses_1', { clock, lifetimeMs: 30_000 });
	clock.advance(29_999);
	assert.equal(registry.activeEpochId('cli_a/ses_1'), epoch.id);
	clock.advance(1);
	assert.equal(registry.activeEpochId('cli_a/ses_1'), null);
	// And the scope is usable again afterwards.
	registry.acquire('cli_a/ses_1', { clock });
});

test('the default lifetime is the 35-minute hard stop', () => {
	assert.equal(DEFAULT_EPOCH_LIFETIME_MS, 35 * 60 * 1_000);
});

test('epoch ids are unique across scopes by default', () => {
	const registry = new VoiceEpochRegistry();
	const ids = new Set(
		['a', 'b', 'c'].map((scope) => registry.acquire(`cli_x/ses_${scope}`).id),
	);
	assert.equal(ids.size, 3);
});
