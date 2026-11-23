import assert from 'node:assert/strict';
import test from 'node:test';

const saved = {
	workflow: { steps: [{ id: 'step_test' }] },
	questions: [{ id: 'q_test', status: 'open' }],
	opportunities: [{ id: 'opp_test' }],
	proposals: [{ plan: { id: 'plan_test' } }],
};

test('loading a revision detects when an editor would lose a review target', async () => {
	const { removedReviewTargets } =
		await import('../../app/composables/workbenchPolicy');
	assert.equal(
		removedReviewTargets(saved, { ...saved, workflow: { steps: [] } }),
		true,
	);
	assert.equal(
		removedReviewTargets(saved, { ...saved, questions: [] }),
		true,
	);
	assert.equal(
		removedReviewTargets(saved, { ...saved, opportunities: [] }),
		true,
	);
	assert.equal(
		removedReviewTargets(saved, { ...saved, proposals: [] }),
		true,
	);
	const answered = {
		...saved,
		questions: [{ id: 'q_test', status: 'answered' }],
	};
	assert.equal(removedReviewTargets(saved, answered), false);
});
