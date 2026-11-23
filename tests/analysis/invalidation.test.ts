// Pure invalidation behavior: source/answer/step edits stale discovery, an
// assumption edit stales only its own proposal, and unrelated commits stale
// nothing. These helpers are what the storage seam calls before committing.
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	stubProvider,
} from './helpers';
import type { Session } from '../../shared/p0/types';
import assert from 'node:assert/strict';
import { computeInvalidation } from '../../server/analysis/invalidate';
import { discover } from '../../server/analysis/discover';
import test from 'node:test';

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

test('transcript and answer edits stale discovery', async () => {
	const previous = await discoveredSession();
	const nextTranscript: Session = {
		...previous,
		transcript: {
			source: 'paste',
			segments:
				previous.transcript?.segments.map((segment, index) =>
					index === 1 ?
						{ ...segment, text: `${segment.text} Actually.` }
					:	segment,
				) ?? [],
		},
	};
	assert.equal(
		computeInvalidation(previous, nextTranscript).discoveryStale,
		true,
	);

	const answered: Session = {
		...previous,
		questions: previous.questions.map((question) =>
			question.id === 'q_a' ?
				{
					...question,
					status: 'answered',
					answer: {
						id: 'ans_x',
						sourceRev: 1,
						text: 'About 30 per day.',
					},
				}
			:	question,
		),
	};
	assert.equal(computeInvalidation(previous, answered).discoveryStale, true);
});

test('a step correction stales discovery even with unchanged sources', async () => {
	const previous = await discoveredSession();
	const withProposal: Session = {
		...previous,
		proposals: [
			{
				opportunityId: 'opp_x',
				graph: { steps: [], edges: [] },
				plan: {
					id: 'plan_x',
					status: 'draft',
					sections: {
						scope: '',
						businessRules: '',
						integrationsAuth: '',
						exceptions: '',
						humanOversight: '',
						milestones: '',
						acceptanceTests: '',
					},
					editedSections: [],
				},
				mode: 'live',
				stale: false,
			},
		],
	};
	const corrected: Session = {
		...withProposal,
		workflow: {
			...withProposal.workflow,
			steps: withProposal.workflow.steps.map((step) =>
				step.id === 'step_a' ?
					{
						...step,
						label: { ...step.label, value: 'Corrected label' },
					}
				:	step,
			),
		},
	};
	const invalidation = computeInvalidation(withProposal, corrected);
	assert.equal(invalidation.discoveryStale, true);
	// The proposal basis (graph + opportunity) changed too.
	assert.deepEqual(invalidation.staleProposalIds, ['opp_x']);
});

test('an assumption edit stales only its own proposal and never discovery', async () => {
	const previous = await discoveredSession();
	const withProposal: Session = {
		...previous,
		proposals: [
			{
				opportunityId: 'opp_x',
				graph: { steps: [], edges: [] },
				plan: {
					id: 'plan_x',
					status: 'draft',
					sections: {
						scope: '',
						businessRules: '',
						integrationsAuth: '',
						exceptions: '',
						humanOversight: '',
						milestones: '',
						acceptanceTests: '',
					},
					editedSections: [],
				},
				mode: 'live',
				stale: false,
			},
		],
	};
	const edited: Session = {
		...withProposal,
		opportunities: withProposal.opportunities.map((opportunity) =>
			opportunity.id === 'opp_x' ?
				{
					...opportunity,
					assumptions: {
						...opportunity.assumptions,
						monthlyOccurrences: {
							...opportunity.assumptions.monthlyOccurrences,
							value: 200,
							edited: true,
						},
					},
					hoursSavedPerMonth: 20,
				}
			:	opportunity,
		),
	};
	const invalidation = computeInvalidation(withProposal, edited);
	assert.equal(invalidation.discoveryStale, false);
	assert.deepEqual(invalidation.staleProposalIds, ['opp_x']);
});

test('an unrelated commit (review notices only) stales nothing', () => {
	const previous = baseSession();
	const next: Session = {
		...previous,
		reviewNotices: [
			{
				code: 'answer_conflict',
				targetId: null,
				message: 'Recorded by the storage seam.',
			},
		],
	};
	const invalidation = computeInvalidation(previous, next);
	assert.equal(invalidation.discoveryStale, false);
	assert.deepEqual(invalidation.staleProposalIds, []);
});
