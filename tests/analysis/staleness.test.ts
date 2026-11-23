// Proposal staleness across a discovery refresh: a proposal is re-enabled only
// when its stored generation fingerprint matches the refreshed basis; absent or
// mismatched fingerprints — including basis edits made between generation and
// the refresh, or a changed provider identity — fail closed to stale, proposals
// whose opportunity vanished are dropped, and the export/approval gate blocks
// while discovery is stale.
import type { Proposal, Session } from '../../shared/p0/types';
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	stubProvider,
} from './helpers';
import {
	isProposalExportBlocked,
	refreshProposalStaleness,
} from '../../server/analysis/staleness';
import type { AnalysisProvider } from '../../server/analysis/provider';
import assert from 'node:assert/strict';
import { discover } from '../../server/analysis/discover';
import { runKey } from '../../server/analysis/keys';
import test from 'node:test';

const provider: AnalysisProvider = stubProvider({});

function draftProposal(opportunityId: string, planId: string): Proposal {
	return {
		opportunityId,
		graph: {
			steps: [
				{
					id: 'pstep_1',
					label: 'Automated entry',
					currentStepIds: ['step_a'],
					evidence: [
						{
							sourceId: 'seg_a',
							sourceRev: 1,
							quote: 'receives the reservation email',
						},
					],
				},
			],
			edges: [],
		},
		plan: {
			id: planId,
			status: 'draft',
			sections: {
				scope: 'Automate.',
				businessRules: 'Structured only.',
				integrationsAuth: 'Service account.',
				exceptions: 'Manual fallback.',
				humanOversight: 'Clerk review.',
				milestones: 'Pilot.',
				acceptanceTests: 'Samples match.',
			},
			editedSections: [],
		},
		mode: 'live',
		stale: false,
	};
}

async function baseWithProposal(): Promise<Session> {
	const first = await discover(
		baseSession(),
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	return {
		...baseSession(),
		...first.patch,
		proposals: [draftProposal('opp_x', 'plan_x')],
		rev: 3,
	};
}

/** Generation fingerprints exactly as the store persists them. */
function generationKeysOf(
	session: Session,
	analysisProvider: AnalysisProvider = provider,
): Record<string, string> {
	return Object.fromEntries(
		session.proposals.map((proposal) => [
			proposal.opportunityId,
			runKey(session, 'propose', analysisProvider, proposal.opportunityId),
		]),
	);
}

test('a proposal generated from the current basis is re-enabled after a refresh', async () => {
	const base = await baseWithProposal();
	const refreshed = refreshProposalStaleness(
		{ ...base, discovery: { ...base.discovery!, stale: true } },
		provider,
		generationKeysOf(base),
	);
	// Same graph/opportunity content since generation: the fingerprint matches.
	assert.equal(refreshed[0]?.stale, false);
});

test('a changed proposal basis stays stale after the refresh', async () => {
	const base = await baseWithProposal();
	const changed: Session = {
		...base,
		workflow: {
			...base.workflow,
			steps: base.workflow.steps.map((step) =>
				step.id === 'step_a' ?
					{
						...step,
						label: { ...step.label, value: 'Rewritten label' },
					}
				:	step,
			),
		},
	};
	const refreshed = refreshProposalStaleness(
		changed,
		provider,
		generationKeysOf(base),
	);
	assert.equal(refreshed[0]?.stale, true);
});

test('an absent generation fingerprint fails closed to stale', async () => {
	const base = await baseWithProposal();
	const refreshed = refreshProposalStaleness(base, provider, {});
	assert.equal(refreshed[0]?.stale, true);
	assert.equal(
		isProposalExportBlocked(
			{ ...base, proposals: refreshed },
			refreshed[0]!,
		),
		true,
	);
});

test('a changed provider identity fails closed to stale', async () => {
	const base = await baseWithProposal();
	const otherProvider = stubProvider({}, { key: 'stub-v2' });
	const refreshed = refreshProposalStaleness(
		base,
		otherProvider,
		generationKeysOf(base, provider),
	);
	assert.equal(refreshed[0]?.stale, true);
});

test('an approved plan stays blocked across an equivalent rediscovery after an assumption edit', async () => {
	const generated = await baseWithProposal();
	const generationKeys = generationKeysOf(generated);

	// The consultant edits an assumption after the proposal was generated and
	// approved; the edit stales the proposal without touching discovery.
	const assumptionEdit: Session = {
		...generated,
		proposals: generated.proposals.map((proposal) => ({
			...proposal,
			plan: { ...proposal.plan, status: 'approved' as const },
			stale: true,
		})),
		opportunities: generated.opportunities.map((opportunity) =>
			opportunity.id === 'opp_x' ?
				{
					...opportunity,
					assumptions: {
						...opportunity.assumptions,
						monthlyOccurrences: {
							...opportunity.assumptions.monthlyOccurrences,
							value: 250,
							edited: true,
						},
					},
					hoursSavedPerMonth: (250 * 6) / 60,
				}
			:	opportunity,
		),
	};

	// An otherwise equivalent rediscovery runs and reproduces the same graph
	// and opportunity — so a pre/post comparison would see no change at all.
	const rediscovery = await discover(
		assumptionEdit,
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	const refreshedSession: Session = {
		...assumptionEdit,
		...rediscovery.patch,
	};
	const refreshed = refreshProposalStaleness(
		refreshedSession,
		provider,
		generationKeys,
	);
	assert.equal(
		refreshed[0]?.stale,
		true,
		'the stale flag must survive an equivalent rediscovery after the edit',
	);
	assert.equal(
		isProposalExportBlocked(
			{ ...refreshedSession, proposals: refreshed },
			refreshed[0]!,
		),
		true,
	);

	// Regenerating stores a fresh fingerprint and re-enables the proposal.
	const regenerated: Session = {
		...refreshedSession,
		proposals: refreshed.map((proposal) => ({
			...proposal,
			stale: false,
		})),
	};
	const afterRegeneration = refreshProposalStaleness(
		regenerated,
		provider,
		generationKeysOf(regenerated),
	);
	assert.equal(afterRegeneration[0]?.stale, false);
	assert.equal(
		isProposalExportBlocked(
			{ ...regenerated, proposals: afterRegeneration },
			afterRegeneration[0]!,
		),
		false,
	);
});

test('a proposal whose opportunity vanished is dropped, not persisted', async () => {
	const base = await baseWithProposal();
	const withoutOpportunity: Session = { ...base, opportunities: [] };
	const refreshed = refreshProposalStaleness(
		withoutOpportunity,
		provider,
		generationKeysOf(base),
	);
	assert.deepEqual(refreshed, []);
});

test('isProposalExportBlocked covers proposal staleness and discovery staleness', async () => {
	const base = await baseWithProposal();
	assert.ok(base.discovery);
	assert.equal(isProposalExportBlocked(base, base.proposals[0]!), false);
	assert.equal(
		isProposalExportBlocked(base, { ...base.proposals[0]!, stale: true }),
		true,
	);
	assert.equal(
		isProposalExportBlocked(
			{ ...base, discovery: { ...base.discovery!, stale: true } },
			base.proposals[0]!,
		),
		true,
	);
	assert.equal(
		isProposalExportBlocked(
			{ ...base, discovery: null },
			base.proposals[0]!,
		),
		true,
	);
});
