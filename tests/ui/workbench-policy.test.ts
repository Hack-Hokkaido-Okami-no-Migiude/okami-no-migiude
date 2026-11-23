import assert from 'node:assert/strict';
import test from 'node:test';

test('external consent is explicit and never attached to a fixture request', async () => {
	const { buildRunRequest } =
		await import('../../app/composables/workbenchPolicy');
	assert.equal(buildRunRequest(7, 'live', false), null);
	assert.deepEqual(buildRunRequest(7, 'live', true), {
		baseRev: 7,
		mode: 'live',
		allowExternal: true,
	});
	assert.deepEqual(buildRunRequest(7, 'fixture', true), {
		baseRev: 7,
		mode: 'fixture',
	});
});

test('stale discovery blocks approval and export even if the selected proposal is current', async () => {
	const { proposalBlocked } =
		await import('../../app/composables/workbenchPolicy');
	assert.equal(proposalBlocked({ stale: true }, { stale: false }), true);
	assert.equal(proposalBlocked({ stale: false }, { stale: true }), true);
	assert.equal(proposalBlocked({ stale: false }, { stale: false }), false);
	assert.equal(proposalBlocked(null, { stale: false }), true);
});
