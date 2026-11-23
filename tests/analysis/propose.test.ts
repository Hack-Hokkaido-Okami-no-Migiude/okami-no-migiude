// Proposal pipeline: valid proposals, rejections (unknown opportunity, empty
// output, duplicate keys, bad prefixes, dangling mappings, edges leaving the
// proposal), and regeneration preserving the plan id plus edited sections.
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	evidenceRef,
	stubProvider,
} from './helpers';
import type { AnalysisProvider } from '../../server/analysis/provider';
import type { Session } from '../../shared/p0/types';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import { discover } from '../../server/analysis/discover';
import { propose } from '../../server/analysis/propose';
import test from 'node:test';

const ALL_SECTIONS = {
	scope: 'Automate booking entry.',
	businessRules: 'Structured emails only.',
	integrationsAuth: 'Service account with PMS scope.',
	exceptions: 'Free text stays manual.',
	humanOversight: 'Clerk reviews each entry.',
	milestones: 'Pilot with two clerks.',
	acceptanceTests: 'Sample emails enter the PMS.',
};

function proposeProvider(
	overrides: Partial<Record<string, unknown>> = {},
): AnalysisProvider {
	return stubProvider({
		propose: () => ({
			planKey: 'plan_new',
			steps: [
				{
					key: 'pstep_entry',
					label: 'Automated booking entry',
					currentStepIds: ['step_a', 'step_b'],
					evidence: [
						evidenceRef('seg_b', 'types the booking into the PMS'),
					],
				},
			],
			edges: [],
			planSections: ALL_SECTIONS,
			...overrides,
		}),
	});
}

async function discoveredSession(): Promise<Session> {
	const first = await discover(
		baseSession(),
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	return { ...baseSession(), ...first.patch, rev: 2 };
}

test('a valid propose output becomes a draft proposal with resolved evidence', async () => {
	const session = await discoveredSession();
	const { proposal, artifactKey } = await propose(
		session,
		'opp_x',
		proposeProvider(),
	);
	assert.equal(proposal.opportunityId, 'opp_x');
	assert.equal(proposal.plan.id, 'plan_new');
	assert.equal(proposal.plan.status, 'draft');
	assert.deepEqual(proposal.plan.sections, ALL_SECTIONS);
	assert.deepEqual(proposal.plan.editedSections, []);
	assert.equal(proposal.graph.steps[0]?.id, 'pstep_entry');
	assert.deepEqual(proposal.graph.steps[0]?.currentStepIds, [
		'step_a',
		'step_b',
	]);
	assert.deepEqual(proposal.graph.steps[0]?.evidence, [
		evidenceRef('seg_b', 'types the booking into the PMS'),
	]);
	assert.equal(proposal.mode, 'live');
	assert.match(artifactKey, /^[0-9a-f]{64}$/);
});

test('an unknown opportunity is rejected as invalid_model_output', async () => {
	const session = await discoveredSession();
	await assert.rejects(
		() => propose(session, 'opp_missing', proposeProvider()),
		(error: unknown) =>
			error instanceof StageError
			&& error.code === 'invalid_model_output'
			&& /Opportunity 'opp_missing' not found\./.test(error.message),
	);
});

test('a proposal without proposed steps is rejected', async () => {
	const session = await discoveredSession();
	await assert.rejects(
		() => propose(session, 'opp_x', proposeProvider({ steps: [] })),
		(error: unknown) =>
			error instanceof StageError
			&& /Proposal output contains no proposed steps\./.test(
				error.message,
			),
	);
});

test('duplicate proposed step keys are rejected', async () => {
	const session = await discoveredSession();
	const duplicated = {
		key: 'pstep_entry',
		label: 'Second copy',
		currentStepIds: [],
		evidence: [evidenceRef('seg_b', 'types the booking into the PMS')],
	};
	await assert.rejects(
		() =>
			propose(
				session,
				'opp_x',
				proposeProvider({ steps: [duplicated, duplicated] }),
			),
		(error: unknown) =>
			error instanceof StageError
			&& /Duplicate proposed step key 'pstep_entry'\./.test(
				error.message,
			),
	);
});

test('proposed ids must keep the pstep_ prefix', async () => {
	const session = await discoveredSession();
	await assert.rejects(
		() =>
			propose(
				session,
				'opp_x',
				proposeProvider({
					steps: [
						{
							key: 'step_new',
							label: 'Wrong prefix',
							currentStepIds: ['step_a'],
							evidence: [
								evidenceRef(
									'seg_a',
									'receives the reservation email',
								),
							],
						},
					],
				}),
			),
		(error: unknown) =>
			error instanceof StageError
			&& /proposed step key 'step_new' must use the 'pstep_' id prefix/.test(
				error.message,
			),
	);
});

test('proposed steps mapping to unknown current steps are rejected', async () => {
	const session = await discoveredSession();
	await assert.rejects(
		() =>
			propose(
				session,
				'opp_x',
				proposeProvider({
					steps: [
						{
							key: 'pstep_entry',
							label: 'Automated booking entry',
							currentStepIds: ['step_ghost'],
							evidence: [
								evidenceRef(
									'seg_b',
									'types the booking into the PMS',
								),
							],
						},
					],
				}),
			),
		(error: unknown) =>
			error instanceof StageError
			&& /maps to unknown current step 'step_ghost'/.test(error.message),
	);
});

test('proposed edges connecting steps outside the proposal are rejected', async () => {
	const session = await discoveredSession();
	await assert.rejects(
		() =>
			propose(
				session,
				'opp_x',
				proposeProvider({
					edges: [
						{
							key: 'pedge_1',
							fromKey: 'pstep_entry',
							toKey: 'step_b',
							label: 'then',
							evidence: [
								evidenceRef('seg_b', 'After reading the email'),
							],
						},
					],
				}),
			),
		(error: unknown) =>
			error instanceof StageError
			&& /connects steps outside the proposal/.test(error.message),
	);
});

test('regeneration keeps the plan id and edited sections, resets to draft', async () => {
	const session = await discoveredSession();
	const first = await propose(session, 'opp_x', proposeProvider());
	const edited: Session = {
		...session,
		proposals: [
			{
				...first.proposal,
				plan: {
					...first.proposal.plan,
					sections: {
						...first.proposal.plan.sections,
						scope: 'Client rewrite.',
					},
					editedSections: ['scope'],
				},
			},
		],
	};
	const second = await propose(edited, 'opp_x', proposeProvider());
	assert.equal(second.proposal.plan.id, first.proposal.plan.id);
	assert.equal(second.proposal.plan.sections.scope, 'Client rewrite.');
	assert.equal(
		second.proposal.plan.sections.businessRules,
		ALL_SECTIONS.businessRules,
	);
	assert.deepEqual(second.proposal.plan.editedSections, ['scope']);
	assert.equal(second.proposal.plan.status, 'draft');
});
