// Store unit tests: the source-change cascade — citations that no longer
// validate are purged from every claim (consultant claims included), edges and
// unsupported proposed steps are removed, consultant values are kept as
// review-only lost-evidence notices, opportunities without support are dropped
// with their proposals, surviving proposals lose stale plan-section copies of
// the moved source text while arbitrary prose is left for review, and a
// committed mutation persists and returns the sanitized payload.
import {
	client,
	edge,
	evidence,
	inferredTextClaim,
	makeSession,
	notice,
	opportunity,
	plan,
	proposal,
	run,
	segment,
	step,
	verifiedTextClaim,
} from './helpers/fixture';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { getOrCreateHotelDemo, readSession } from '../../server/store/repository';
import { stripInvalidCitations, withLostNotices } from '../../server/store/cascade';
import assert from 'node:assert/strict';
import { commitSessionMutation } from '../../server/store/commit-session';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);

function useFreshDataDir(): string {
	const directory = mkdtempSync(path.join(repoRoot, '.data', 'cascade-'));
	process.env.NUXT_DATA_DIR = directory;
	return directory;
}

/** seg_src1 changed (rev 2); seg_src2 kept its original wording and revision. */
function changedSourceSession() {
	return makeSession({
		segments: [
			segment(
				'seg_src1',
				'The clerk types every booking into the PMS by hand, slowly.',
				2,
			),
			segment('seg_src2', 'Then housekeeping retype the list into their sheet.'),
		],
		steps: [
			step('step_1', inferredTextClaim('Type booking', [
				evidence('seg_src1', 1, 'types every booking into the PMS'),
			])),
			step('step_2', inferredTextClaim('Retype list', [
				evidence('seg_src2', 1, 'housekeeping retype the list'),
			]), {
				tool: verifiedTextClaim('YukiReserve', [
					evidence('seg_src2', 1, 'housekeeping retype the list'),
				]),
			}),
			// A consultant-verified claim citing the changed row: the stale
			// citation is purged and the consultant value is kept for review.
			step('step_3', verifiedTextClaim('Verified label', [
				evidence('seg_src1', 1, 'types every booking into the PMS'),
			])),
			// A consultant claim with one stale and one valid citation: the
			// value survives with the remaining support.
			step('step_4', verifiedTextClaim('Checked twice', [
				evidence('seg_src1', 1, 'types every booking into the PMS'),
				evidence('seg_src2', 1, 'housekeeping retype the list'),
			])),
		],
		edges: [
			// Supported by the unchanged row: kept.
			edge('edge_1', 'step_1', 'step_2', [
				evidence('seg_src2', 1, 'Then housekeeping retype'),
			]),
			// Sequence supported only by the changed row: dropped.
			edge('edge_2', 'step_2', 'step_3', [
				evidence('seg_src1', 1, 'types every booking into the PMS'),
			]),
			// Decision edge whose condition lost its support: dropped.
			edge('edge_3', 'step_3', 'step_1', [
				evidence('seg_src2', 1, 'Then housekeeping retype'),
			], {
				kind: 'decision',
				condition: {
					...inferredTextClaim('When the email is a modification', [
						evidence('seg_src1', 1, 'types every booking into the PMS'),
					]),
				},
			}),
		],
		opportunities: [
			// Every citation became invalid: dropped with its proposal.
			opportunity('opp_lost', ['step_1'], [
				evidence('seg_src1', 1, 'types every booking into the PMS'),
			]),
			// Still backed by the unchanged row: kept.
			opportunity('opp_kept', ['step_2'], [
				evidence('seg_src2', 1, 'housekeeping retype the list'),
			]),
		],
		proposals: [
			proposal('opp_lost', 'plan_lost'),
			// A surviving proposal whose graph and plan carry stale copies of
			// the moved source text: sanitized, not dropped.
			proposal('opp_kept', 'plan_kept', {
				mode: 'live',
				graph: {
					steps: [
						{
							id: 'pstep_1',
							label: 'Automated entry',
							currentStepIds: ['step_1'],
							evidence: [
								evidence('seg_src1', 1, 'types every booking into the PMS'),
							],
						},
						{
							id: 'pstep_2',
							label: 'Retype reminder',
							currentStepIds: ['step_2'],
							evidence: [
								evidence('seg_src2', 1, 'housekeeping retype the list'),
							],
						},
						{
							id: 'pstep_3',
							label: 'Update the sheet',
							currentStepIds: ['step_2'],
							evidence: [
								evidence('seg_src2', 1, 'Then housekeeping retype'),
							],
						},
					],
					edges: [
						{
							id: 'pedge_1',
							fromStepId: 'pstep_1',
							toStepId: 'pstep_2',
							label: 'Then',
							evidence: [
								evidence('seg_src2', 1, 'Then housekeeping retype'),
							],
						},
						{
							id: 'pedge_2',
							fromStepId: 'pstep_2',
							toStepId: 'pstep_3',
							label: 'After the retype',
							evidence: [
								evidence('seg_src2', 1, 'Then housekeeping retype'),
							],
						},
					],
				},
				plan: {
					...plan('plan_kept'),
					sections: {
						...plan('plan_kept').sections,
						// Verbatim copy of the moved source text: purged.
						scope: 'Automate the entry: types every booking into the PMS, then confirm.',
						// Arbitrary prose that merely references the workflow: kept.
						businessRules: 'The clerk keeps working from the sheet until cutover.',
					},
				},
			}),
		],
	});
}

test('unsupported analysis claims revert to unknown; consultant values stay review-only', () => {
	const cascade = stripInvalidCitations(changedSourceSession());
	const byId = new Map(cascade.steps.map((entry) => [entry.id, entry]));

	const step1 = byId.get('step_1');
	assert.deepEqual(
		{
			value: step1?.label.value,
			state: step1?.label.state,
			author: step1?.label.author,
			evidence: step1?.label.evidence,
		},
		{ value: null, state: 'unknown', author: 'analysis', evidence: [] },
	);
	assert.equal(step1?.graphEligible, false, 'unlabelled steps stay review-only');

	const step2 = byId.get('step_2');
	assert.equal(step2?.label.value, 'Retype list', 'supported claim survives');
	assert.equal(step2?.tool.state, 'consultant-verified');
	assert.equal(step2?.tool.value, 'YukiReserve');

	// The consultant claim lost its only citation: the stale copy is purged,
	// the claim reverts to the consultant unknown form, and the value is kept
	// for review in a lost-evidence notice instead of being deleted.
	const step3 = byId.get('step_3');
	assert.deepEqual(
		{
			value: step3?.label.value,
			state: step3?.label.state,
			author: step3?.label.author,
			evidence: step3?.label.evidence,
		},
		{ value: null, state: 'unknown', author: 'consultant', evidence: [] },
	);
	assert.equal(step3?.graphEligible, false);
	assert.ok(
		cascade.lostNotices.some((entry) =>
			entry.code === 'lost_evidence'
			&& entry.targetId === 'step_3'
			&& entry.message.includes("'Verified label'")
			&& entry.message.includes('kept for review'),
		),
		'the purged consultant value is retained as a review-only notice',
	);

	// One stale and one valid citation: the value keeps its state with the
	// surviving reference only.
	const step4 = byId.get('step_4');
	assert.equal(step4?.label.value, 'Checked twice');
	assert.equal(step4?.label.state, 'consultant-verified');
	assert.deepEqual(
		step4?.label.evidence.map((ref) => ref.sourceId),
		['seg_src2'],
	);
	assert.equal(step4?.graphEligible, true);
});

test('edges without support are removed; decision edges need their condition', () => {
	const cascade = stripInvalidCitations(changedSourceSession());
	const ids = cascade.edges.map((entry) => entry.id).sort();
	assert.deepEqual(ids, ['edge_1']);
	// Proposal losses are reported against the proposal's opportunity.
	assert.deepEqual(
		cascade.lostNotices.map((entry) => [entry.code, entry.targetId]).sort(),
		[
			['lost_evidence', 'edge_2'],
			['lost_evidence', 'edge_3'],
			['lost_evidence', 'opp_kept'],
			['lost_evidence', 'opp_kept'],
			['lost_evidence', 'opp_lost'],
			['lost_evidence', 'step_3'],
		].sort(),
	);
});

test('opportunities without any valid citation are dropped with their proposals', () => {
	const cascade = stripInvalidCitations(changedSourceSession());
	assert.deepEqual(cascade.droppedOpportunityIds, ['opp_lost']);
	assert.deepEqual(
		cascade.opportunities.map((entry) => entry.id),
		['opp_kept'],
	);
	assert.deepEqual(
		cascade.proposals.map((entry) => entry.opportunityId),
		['opp_kept'],
	);
});

test('surviving proposals lose unsupported steps, dangling edges, and stale plan copies', () => {
	const cascade = stripInvalidCitations(changedSourceSession());
	const surviving = cascade.proposals[0];

	// The unsupported proposed step and the edge that referenced it are gone;
	// the supported steps and their edge remain.
	assert.deepEqual(
		surviving?.graph.steps.map((entry) => entry.id),
		['pstep_2', 'pstep_3'],
	);
	assert.deepEqual(
		surviving?.graph.edges.map((entry) => entry.id),
		['pedge_2'],
	);
	assert.deepEqual(
		surviving?.graph.steps[0]?.evidence.map((ref) => ref.sourceId),
		['seg_src2'],
		'surviving proposed steps keep only valid citations',
	);

	// Verbatim copies of the moved source text are deleted from plan
	// sections; arbitrary prose that paraphrases the workflow is kept.
	assert.equal(
		surviving?.plan.sections.scope.includes('types every booking into the PMS'),
		false,
	);
	assert.ok(surviving?.plan.sections.scope.includes(', then confirm.'));
	assert.equal(
		surviving?.plan.sections.businessRules,
		'The clerk keeps working from the sheet until cutover.',
	);

	// The stale quote is reported exactly once for the scrub surface.
	assert.deepEqual(cascade.staleQuotes, ['types every booking into the PMS']);
});

test('unchanged sources keep every citation intact', () => {
	const cascade = stripInvalidCitations(makeSession());
	assert.deepEqual(cascade.droppedOpportunityIds, []);
	assert.deepEqual(cascade.lostNotices, []);
	assert.deepEqual(cascade.staleQuotes, []);
	assert.equal(cascade.steps.length, 2);
	assert.equal(cascade.edges.length, 1);
	const keptStep = cascade.steps[0];
	assert.equal(keptStep?.graphEligible, true);
	assert.equal(keptStep?.label.evidence.length, 1);
});

test('a committed transcript mutation persists and returns the sanitized surviving proposal', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_t1'),
		session: makeSession({
			discovery: run('fixture'),
			opportunities: [
				opportunity('opp_kept', ['step_2'], [
					evidence('seg_src2', 1, 'housekeeping retype the list'),
				]),
			],
			proposals: [proposal('opp_kept', 'plan_kept', {
				mode: 'live',
				graph: {
					steps: [
						{
							id: 'pstep_1',
							label: 'Automated entry',
							currentStepIds: ['step_1'],
							evidence: [
								evidence('seg_src1', 1, 'types every booking into the PMS'),
							],
						},
						{
							id: 'pstep_2',
							label: 'Retype reminder',
							currentStepIds: ['step_2'],
							evidence: [
								evidence('seg_src2', 1, 'housekeeping retype the list'),
							],
						},
					],
					edges: [
						{
							id: 'pedge_1',
							fromStepId: 'pstep_1',
							toStepId: 'pstep_2',
							label: 'Then',
							evidence: [
								evidence('seg_src2', 1, 'Then housekeeping retype'),
							],
						},
					],
				},
				plan: {
					...plan('plan_kept'),
					sections: {
						...plan('plan_kept').sections,
						scope: 'Automate the entry: types every booking into the PMS, then confirm.',
					},
				},
			})],
		}),
	};
	await getOrCreateHotelDemo(seed);
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	const returned = await commitSessionMutation(key, 1, (current) => {
		const transcript = current.session.transcript;
		const segments = transcript
			? [
				{
					...transcript.segments[0],
					text: 'The clerk types every booking into the PMS by hand, slowly.',
					sourceRev: 2,
				},
				...transcript.segments.slice(1),
			]
			: [];
		return {
			session: {
				...current.session,
				transcript: { source: 'paste' as const, segments },
			},
		};
	}, { cascadeCitations: true });

	assert.equal(returned.rev, 2);
	assert.equal(returned.discovery?.stale, true);
	const returnedProposal = returned.proposals[0];
	assert.ok(returnedProposal, 'the surviving proposal is returned');
	assert.deepEqual(
		returnedProposal.graph.steps.map((entry) => entry.id),
		['pstep_2'],
	);
	assert.deepEqual(returnedProposal.graph.edges, []);
	assert.equal(
		returnedProposal.plan.sections.scope.includes('types every booking into the PMS'),
		false,
		'the stale source copy is scrubbed from the returned plan',
	);
	assert.ok(
		returned.reviewNotices.some((entry) =>
			entry.code === 'lost_evidence'
			&& entry.targetId === 'opp_kept'
			&& entry.message.includes("Proposed step 'pstep_1'"),
		),
	);

	// The persisted payload matches what the mutation returned.
	const stored = await readSession(key);
	assert.deepEqual(stored?.session.proposals, returned.proposals);
	assert.deepEqual(stored?.session.reviewNotices, returned.reviewNotices);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
	assert.ok(!existsSync(process.env.NUXT_DATA_DIR));
});

test('lost notices are appended without duplicates', () => {
	const existing = [
		notice('lost_evidence', 'edge_2', 'Edge edge_2 lost its cited source support and was removed.'),
	];
	const appended = withLostNotices(existing, [
		notice('lost_evidence', 'edge_2', 'Edge edge_2 lost its cited source support and was removed.'),
		notice('lost_evidence', 'edge_3', 'Edge edge_3 lost its cited source support and was removed.'),
	]);
	assert.equal(appended.length, 2);
});
