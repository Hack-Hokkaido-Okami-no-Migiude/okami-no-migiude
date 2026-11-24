import { PublicTaskSchema } from '../../shared/shima/schemas';
import assert from 'node:assert/strict';
import test from 'node:test';

const task = PublicTaskSchema.parse({
	title: '架空の作業',
	problem: '手順を整理したい',
	proposedChange: '表を使う',
	deliverables: ['表のひな形', '手順書'],
	acceptanceCriteria: ['試験に合格する'],
	skills: ['表計算'],
	integrations: [],
	benefits: ['確認しやすい'],
	prerequisites: ['試験用のデータ'],
	limitations: ['手動確認は必要'],
	confirmedBudgetYen: 0,
	targetDate: '2026-12-18',
	estimatedHoursSavedPerMonth: 0.125,
});

test('only server-listed demo modes expose a demo UI', async () => {
	const { shimaDemoSurface } =
		await import('../../app/composables/useShimaSurface');
	assert.equal(shimaDemoSurface(undefined), 'fixture-local');
	assert.equal(shimaDemoSurface('public-demo'), 'public-demo');
	for (const mode of ['real-pilot', 'private-capture', 'typo', '']) {
		assert.equal(shimaDemoSurface(mode), 'closed');
	}
});

test('published does not mean completed without the private server flag', async () => {
	const { shimaCompleted } =
		await import('../../app/composables/useShimaPresentation');
	assert.equal(
		shimaCompleted({ state: 'published', completed: false }),
		false,
	);
	assert.equal(shimaCompleted({ state: 'draft', completed: true }), false);
	assert.equal(shimaCompleted({ state: 'published', completed: true }), true);
});

test('the exact card exposes every public task field and value in source order', async () => {
	const { publicTaskFields } =
		await import('../../app/composables/useShimaPresentation');
	const fields = publicTaskFields(task);
	assert.deepEqual(
		Object.fromEntries(fields.map(({ key, value }) => [key, value])),
		task,
	);
	assert.deepEqual(
		Object.keys(
			fields.reduce(
				(keys, field) => ({ ...keys, [field.key]: true }),
				{},
			),
		),
		Object.keys(PublicTaskSchema.shape),
	);
});

test('both approvals apply only to a current preview bound to the accepted draft', async () => {
	const { canPublishShimaPreview } =
		await import('../../app/composables/useShimaPresentation');
	const context = {
		package: {
			state: 'draft' as const,
			stale: false,
			ownerDecision: 'accept' as const,
			previewId: 'prv_current',
			draft: { proposedBudgetYen: 0, targetDate: task.targetDate },
		},
		preview: { id: 'prv_current', hash: 'current', task },
		confirmBudget: true,
		approvePreview: true,
	};
	assert.equal(canPublishShimaPreview(context), true);
	assert.equal(
		canPublishShimaPreview({ ...context, confirmBudget: false }),
		false,
	);
	assert.equal(
		canPublishShimaPreview({ ...context, approvePreview: false }),
		false,
	);
	assert.equal(
		canPublishShimaPreview({
			...context,
			preview: { ...context.preview, id: 'prv_old' },
		}),
		false,
	);
	assert.equal(
		canPublishShimaPreview({
			...context,
			package: { ...context.package, stale: true },
		}),
		false,
	);
	assert.equal(
		canPublishShimaPreview({
			...context,
			package: { ...context.package, ownerDecision: 'decline' },
		}),
		false,
	);
	assert.equal(
		canPublishShimaPreview({
			...context,
			package: { ...context.package, state: 'published' },
		}),
		false,
	);
	assert.equal(
		canPublishShimaPreview({
			...context,
			package: {
				...context.package,
				draft: { ...context.package.draft, proposedBudgetYen: 1 },
			},
		}),
		false,
	);
});
