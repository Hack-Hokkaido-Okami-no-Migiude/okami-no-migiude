import {
	type PilotReleaseContext,
	createPilotRelease,
	reconcilePilotRelease,
	transitionPilotRelease,
} from '../../server/pilot/release';
import { PublicTaskSchema } from '../../shared/shima/schemas';
import assert from 'node:assert/strict';
import { publicTaskHash } from '../../shared/shima/hash';
import test from 'node:test';

const binding = {
	businessId: 'synthetic-business-a',
	packageId: 'synthetic-package-a',
};
const current = {
	...binding,
	dataKind: 'pilot',
	rev: 5,
	basis: 'synthetic-basis-1',
	proposedBudgetYen: 0,
	permissionId: 'synthetic-explicit-release-1',
	ownerId: 'synthetic-owner',
	reviewerId: 'synthetic-reviewer',
	adminId: 'synthetic-admin',
} as const;
const reviewer = {
	actorId: current.reviewerId,
	businessId: binding.businessId,
	role: 'reviewer',
} as const;
const deployment = {
	mode: 'real-pilot',
	realPilotEnabled: true,
	cohortTargetDate: '2027-03-31',
} as const;
const ready = {
	current,
	principal: reviewer,
	deployment,
} satisfies PilotReleaseContext;
const selection = {
	template: 'review-checklist-v1',
	confirmedBudgetYen: 0,
} as const;
const preview = { kind: 'preview', baseRev: 5, selection } as const;
const key = '00000000-0000-4000-8000-000000000001';
const owner = {
	actorId: current.ownerId,
	businessId: binding.businessId,
	role: 'owner',
} as const;
const admin = {
	actorId: current.adminId,
	businessId: binding.businessId,
	role: 'admin',
} as const;

function receipt(n: number) {
	return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

test('release defaults closed and ignores attempts from the fixture lane or the wrong principal', () => {
	const state = createPilotRelease(binding);
	for (const context of [
		{ ...ready, deployment: undefined },
		{ ...ready, deployment: { mode: 'real-pilot' } },
		{
			...ready,
			deployment: { mode: 'real-pilot', realPilotEnabled: true },
		},
		{
			...ready,
			deployment: { ...deployment, cohortTargetDate: '2027-03-29' },
		},
		{
			...ready,
			deployment: { ...deployment, cohortTargetDate: '2027-03-31\n' },
		},
		{ ...ready, deployment: { ...deployment, mode: 'private-capture' } },
		{ ...ready, deployment: { ...deployment, mode: 'fixture-local' } },
		{ ...ready, current: { ...current, dataKind: 'fixture' } },
		{ ...ready, principal: null },
		{ ...ready, principal: { ...reviewer, role: 'owner' } },
		{ ...ready, principal: { ...reviewer, actorId: 'unnamed-reviewer' } },
		{
			...ready,
			principal: { ...reviewer, businessId: 'synthetic-business-b' },
		},
		{ ...ready, current: { ...current, packageId: 'another-package' } },
	] satisfies PilotReleaseContext[]) {
		assert.deepEqual(transitionPilotRelease(state, context, preview, key), {
			ok: false,
			code: 'not_found',
		});
	}
});

test('preview generates an immutable, strict public template from an enumerated selection', () => {
	const state = createPilotRelease(binding);
	for (const invalid of [
		{ ...selection, notes: 'private sentinel' },
		{ ...selection, targetDate: '2027-03-31' },
		{ ...selection, template: 'private sentinel' },
		{ ...selection, confirmedBudgetYen: '0' },
		{ ...selection, confirmedBudgetYen: 0.25 },
		{ ...selection, confirmedBudgetYen: -1 },
		{ ...selection, confirmedBudgetYen: 100_000_001 },
	]) {
		assert.deepEqual(
			transitionPilotRelease(
				state,
				ready,
				{ ...preview, selection: invalid },
				key,
			),
			{
				ok: false,
				code: 'invalid_input',
			},
		);
	}
	const result = transitionPilotRelease(state, ready, preview, key);
	assert.deepEqual(
		transitionPilotRelease(
			state,
			{ ...ready, current: { ...current, proposedBudgetYen: null } },
			preview,
			key,
		),
		{
			ok: false,
			code: 'stale_preview',
		},
	);
	assert.ok(result.ok);
	assert.equal(result.rev, 6);
	assert.equal(result.boardEffect, null);
	assert.equal(state.preview, null);
	assert.ok(result.state.preview);
	const { id, hash, task } = result.state.preview;
	assert.match(id, /^prv_[a-f0-9-]{36}$/u);
	assert.equal(hash, publicTaskHash(task));
	assert.equal(task.confirmedBudgetYen, 0);
	assert.equal(task.targetDate, '2027-03-31');
	assert.ok(Object.isFrozen(task));
	assert.ok(Object.isFrozen(task.deliverables));
});

function reviewedCard() {
	const prepared = transitionPilotRelease(
		createPilotRelease(binding),
		ready,
		preview,
		key,
	);
	assert.ok(prepared.ok && prepared.state.preview);
	const exact = {
		previewId: prepared.state.preview.id,
		previewHash: prepared.state.preview.hash,
	};
	const review = {
		kind: 'review',
		...exact,
		approvePreview: true,
		baseRev: 6,
	} as const;
	const reviewed = transitionPilotRelease(
		prepared.state,
		{ ...ready, current: { ...current, rev: 6 } },
		review,
		receipt(2),
	);
	assert.ok(reviewed.ok);
	return { exact, reviewed, prepared };
}

test('owner and reviewer are separately named and bound to the exact card and integer yen', () => {
	const { exact, reviewed, prepared } = reviewedCard();
	const review = {
		kind: 'review',
		...exact,
		baseRev: 6,
		approvePreview: true,
	};
	assert.deepEqual(
		transitionPilotRelease(
			prepared.state,
			{ ...ready, principal: owner },
			review,
			receipt(2),
		),
		{
			ok: false,
			code: 'not_found',
		},
	);
	const approve = {
		kind: 'approve',
		...exact,
		baseRev: 7,
		approvePreview: true,
		confirmBudget: true,
		confirmedBudgetYen: 0,
	} as const;
	const approvalContext = {
		...ready,
		principal: owner,
		current: { ...current, rev: 7 },
	};
	for (const context of [
		{ ...approvalContext, principal: reviewer },
		{
			...approvalContext,
			current: { ...approvalContext.current, reviewerId: owner.actorId },
		},
		{
			...approvalContext,
			principal: { ...owner, businessId: 'synthetic-business-b' },
		},
	]) {
		assert.deepEqual(
			transitionPilotRelease(
				reviewed.state,
				context,
				approve,
				receipt(3),
			),
			{ ok: false, code: 'not_found' },
		);
	}
	for (const changes of [
		{ confirmedBudgetYen: '0' },
		{ confirmedBudgetYen: 0.1 },
		{ confirmBudget: false },
		{ approvePreview: false },
	]) {
		assert.deepEqual(
			transitionPilotRelease(
				reviewed.state,
				approvalContext,
				{ ...approve, ...changes },
				receipt(3),
			),
			{ ok: false, code: 'invalid_input' },
		);
	}
	for (const changes of [
		{ confirmedBudgetYen: 1 },
		{ previewHash: 'f'.repeat(64) },
		{ previewId: `prv_${receipt(55)}` },
	]) {
		assert.deepEqual(
			transitionPilotRelease(
				reviewed.state,
				approvalContext,
				{ ...approve, ...changes },
				receipt(3),
			),
			{ ok: false, code: 'stale_preview' },
		);
	}
	assert.deepEqual(
		transitionPilotRelease(
			reviewed.state,
			approvalContext,
			{ ...approve, baseRev: 6 },
			receipt(3),
		),
		{ ok: false, code: 'revision_conflict' },
	);
	const approved = transitionPilotRelease(
		reviewed.state,
		approvalContext,
		approve,
		receipt(3),
	);
	assert.ok(approved.ok);
	assert.equal(approved.state.ownerApproval?.actorId, owner.actorId);
	assert.equal(approved.state.reviewerCheck?.actorId, reviewer.actorId);
	assert.equal(approved.boardEffect, null);
});

function approvedCard() {
	const { exact, reviewed } = reviewedCard();
	const approved = transitionPilotRelease(
		reviewed.state,
		{ ...ready, principal: owner, current: { ...current, rev: 7 } },
		{
			kind: 'approve',
			...exact,
			baseRev: 7,
			approvePreview: true,
			confirmBudget: true,
			confirmedBudgetYen: 0,
		},
		receipt(3),
	);
	assert.ok(approved.ok);
	const permit = {
		kind: 'permit',
		...exact,
		granted: true,
		baseRev: 8,
	} as const;
	const permitContext = {
		...ready,
		principal: admin,
		current: { ...current, rev: 8 },
	};
	const publish = {
		kind: 'publish',
		...exact,
		baseRev: 9,
		confirmBudget: true,
		confirmedBudgetYen: 0,
	} as const;
	const publishContext = {
		...ready,
		principal: admin,
		current: { ...current, rev: 9 },
	};
	return { approved, exact, permit, permitContext, publish, publishContext };
}

function permittedCard() {
	const card = approvedCard();
	const permitted = transitionPilotRelease(
		card.approved.state,
		card.permitContext,
		card.permit,
		receipt(4),
	);
	assert.ok(permitted.ok);
	return { ...card, permitted };
}

test('only the named admin permits a card in its own business', () => {
	const { approved, permit, permitContext } = approvedCard();
	for (const principal of [
		owner,
		reviewer,
		{ ...admin, actorId: 'unnamed-admin' },
		{ ...admin, businessId: 'synthetic-business-b' },
	]) {
		assert.deepEqual(
			transitionPilotRelease(
				approved.state,
				{ ...permitContext, principal },
				permit,
				receipt(4),
			),
			{
				ok: false,
				code: 'not_found',
			},
		);
	}
	assert.deepEqual(
		transitionPilotRelease(
			approved.state,
			permitContext,
			{ ...permit, previewHash: 'f'.repeat(64) },
			receipt(4),
		),
		{
			ok: false,
			code: 'stale_preview',
		},
	);
});

test('publish revalidates permit, authorities, current permission, basis, yen, and stored bytes', () => {
	const { approved, permitted, publish, publishContext } = permittedCard();
	const write = (
		state = permitted.state,
		context: PilotReleaseContext = publishContext,
		input: unknown = publish,
	) => transitionPilotRelease(state, context, input, receipt(5));
	assert.deepEqual(write(approved.state), {
		ok: false,
		code: 'release_not_permitted',
	});
	assert.deepEqual(write({ ...permitted.state, ownerApproval: null }), {
		ok: false,
		code: 'release_not_permitted',
	});
	assert.deepEqual(write({ ...permitted.state, reviewerCheck: null }), {
		ok: false,
		code: 'release_not_permitted',
	});
	assert.ok(permitted.state.permit && permitted.state.preview);
	const { permit, preview: storedPreview } = permitted.state;
	assert.deepEqual(
		write({
			...permitted.state,
			permit: { ...permit, cardBinding: 'another-binding' },
		}),
		{ ok: false, code: 'release_not_permitted' },
	);
	assert.deepEqual(
		write(undefined, { ...publishContext, principal: owner }),
		{ ok: false, code: 'not_found' },
	);
	assert.deepEqual(
		write(undefined, {
			...publishContext,
			current: { ...publishContext.current, permissionId: null },
		}),
		{ ok: false, code: 'consent_required' },
	);
	for (const changes of [
		{ basis: 'synthetic-basis-2' },
		{ proposedBudgetYen: 1 },
		{ permissionId: 'replacement-permission' },
		{ reviewerId: 'replacement-reviewer' },
	]) {
		assert.deepEqual(
			write(undefined, {
				...publishContext,
				current: { ...publishContext.current, ...changes },
			}),
			{ ok: false, code: 'stale_preview' },
		);
	}
	assert.deepEqual(
		write(undefined, undefined, { ...publish, confirmedBudgetYen: 1 }),
		{ ok: false, code: 'stale_preview' },
	);
	assert.deepEqual(
		write(undefined, undefined, { ...publish, confirmBudget: false }),
		{ ok: false, code: 'invalid_input' },
	);
	const foreignTask = { ...storedPreview.task, title: current.businessId };
	const foreignHash = publicTaskHash(foreignTask);
	assert.deepEqual(
		write(
			{
				...permitted.state,
				preview: {
					...storedPreview,
					task: foreignTask,
					hash: foreignHash,
				},
			},
			undefined,
			{ ...publish, previewHash: foreignHash },
		),
		{
			ok: false,
			code: 'stale_preview',
		},
	);
});

function publishedCard() {
	const card = permittedCard();
	const published = transitionPilotRelease(
		card.permitted.state,
		card.publishContext,
		card.publish,
		receipt(5),
	);
	assert.ok(published.ok && published.boardEffect?.kind === 'put');
	return { ...card, published, quest: published.boardEffect.quest };
}

test('synthetic publish emits only strict public keys and exact replay has no board effect', () => {
	const { publish, publishContext, published, quest } = publishedCard();
	assert.deepEqual(Object.keys(quest).sort(), ['id', 'rev', 'state', 'task']);
	assert.deepEqual(
		Object.keys(quest.task).sort(),
		Object.keys(PublicTaskSchema.shape).sort(),
	);
	assert.equal(quest.rev, 0);
	assert.equal(quest.state, 'available');
	assert.match(quest.id, /^qst_[a-f0-9-]{36}$/u);
	assert.equal(publicTaskHash(quest.task), publish.previewHash);
	assert.doesNotMatch(
		JSON.stringify(quest),
		/synthetic-|previewId|previewHash|prv_/u,
	);
	const context = {
		...publishContext,
		current: { ...publishContext.current, rev: 10 },
	};
	const replay = transitionPilotRelease(
		published.state,
		context,
		publish,
		receipt(5),
	);
	assert.ok(replay.ok && replay.replayed);
	assert.equal(replay.state, published.state);
	assert.equal(replay.boardEffect, null);
	assert.equal(replay.questId, quest.id);
	assert.deepEqual(
		transitionPilotRelease(
			published.state,
			context,
			{ ...publish, baseRev: 10 },
			receipt(5),
		),
		{ ok: false, code: 'idempotency_conflict' },
	);
	assert.deepEqual(
		transitionPilotRelease(
			published.state,
			{ ...context, principal: owner },
			publish,
			receipt(5),
		),
		{ ok: false, code: 'not_found' },
	);
	assert.deepEqual(
		transitionPilotRelease(
			published.state,
			context,
			{ ...publish, baseRev: 10 },
			receipt(19),
		),
		{ ok: false, code: 'already_published' },
	);
});

test('a replacement preview with identical bytes has a new binding and clears all prior checks', () => {
	const { permitted, exact } = permittedCard();
	const context = { ...ready, current: { ...current, rev: 9 } };
	const replaced = transitionPilotRelease(
		permitted.state,
		context,
		{ ...preview, baseRev: 9 },
		receipt(7),
	);
	assert.ok(replaced.ok && replaced.state.preview);
	assert.equal(replaced.state.preview.hash, exact.previewHash);
	assert.notEqual(replaced.state.preview.id, exact.previewId);
	assert.equal(replaced.state.ownerApproval, null);
	assert.equal(replaced.state.reviewerCheck, null);
	assert.equal(replaced.state.permit, null);
	assert.deepEqual(
		transitionPilotRelease(
			replaced.state,
			{ ...context, current: { ...context.current, rev: 10 } },
			preview,
			key,
		),
		{ ok: false, code: 'not_found' },
	);
});

test('withdrawal and permit revocation remove the card and cannot be undone by replay', () => {
	const { publish, publishContext, published, quest, exact } =
		publishedCard();
	const context = {
		...publishContext,
		current: { ...publishContext.current, rev: 10 },
	};
	for (const [actor, command] of [
		[owner, { kind: 'withdraw', ...exact, baseRev: 10 }],
		[admin, { kind: 'permit', ...exact, baseRev: 10, granted: false }],
	] as const) {
		const removed = transitionPilotRelease(
			published.state,
			{ ...context, principal: actor },
			command,
			receipt(6),
		);
		assert.ok(removed.ok);
		assert.deepEqual(removed.boardEffect, { kind: 'remove', id: quest.id });
		assert.equal(removed.state.preview, null);
		assert.equal(removed.state.ownerApproval, null);
		assert.equal(removed.state.reviewerCheck, null);
		assert.equal(removed.state.permit, null);
		assert.deepEqual(
			transitionPilotRelease(
				removed.state,
				{ ...context, current: { ...context.current, rev: 11 } },
				publish,
				receipt(5),
			),
			{ ok: false, code: 'not_found' },
		);
	}
});

test('repo reconciliation clears on reshape, changed basis, or lost deployment scope', () => {
	const { publishContext, published, quest } = publishedCard();
	const { current: latest } = publishContext;
	assert.deepEqual(reconcilePilotRelease(published.state, publishContext), {
		state: published.state,
		boardEffect: null,
	});
	for (const result of [
		reconcilePilotRelease(published.state, publishContext, 'reshape'),
		reconcilePilotRelease(published.state, {
			...publishContext,
			current: { ...latest, basis: 'new-basis' },
		}),
		reconcilePilotRelease(published.state, {
			...publishContext,
			current: { ...latest, proposedBudgetYen: 1 },
		}),
		reconcilePilotRelease(published.state, {
			...publishContext,
			current: { ...latest, permissionId: null },
		}),
		reconcilePilotRelease(published.state, {
			...publishContext,
			deployment: undefined,
		}),
	]) {
		assert.equal(result.state.preview, null);
		assert.equal(result.state.reviewerCheck, null);
		assert.equal(result.state.ownerApproval, null);
		assert.equal(result.state.permit, null);
		assert.deepEqual(result.boardEffect, { kind: 'remove', id: quest.id });
	}
});
