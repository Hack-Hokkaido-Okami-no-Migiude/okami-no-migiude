// Savings math and plan rendering: hours = occurrences × minutes ÷ 60 (zero is
// valid, missing inputs stay null), markdown section order, savings labels, the
// provenance disclaimer, and no raw transcript text in the output.
import type { Proposal, Session } from '../../shared/p0/types';
import {
	baseAssessment,
	baseExtraction,
	baseSession,
	stubProvider,
} from './helpers';
import assert from 'node:assert/strict';
import { computeHoursSaved } from '../../server/analysis/reconcile-opportunities';
import { discover } from '../../server/analysis/discover';
import { renderPlanMarkdown } from '../../server/analysis/markdown';
import test from 'node:test';

test('computeHoursSaved follows occurrences × minutes ÷ 60', () => {
	const assumption = (value: number | null) => ({
		value,
		basis: 'test',
		evidence: [],
		edited: false,
	});
	assert.equal(
		computeHoursSaved({
			monthlyOccurrences: assumption(100),
			minutesSaved: assumption(30),
		}),
		50,
	);
	assert.equal(
		computeHoursSaved({
			monthlyOccurrences: assumption(0),
			minutesSaved: assumption(30),
		}),
		0,
		'zero occurrences is a valid estimate, not missing data',
	);
	assert.equal(
		computeHoursSaved({
			monthlyOccurrences: assumption(null),
			minutesSaved: assumption(30),
		}),
		null,
	);
	assert.equal(
		computeHoursSaved({
			monthlyOccurrences: assumption(100),
			minutesSaved: assumption(null),
		}),
		null,
	);
});

async function sessionWithProposal(): Promise<{
	session: Session;
	proposal: Proposal;
}> {
	const first = await discover(
		baseSession(),
		stubProvider({
			extract: () => baseExtraction(),
			assess: () => baseAssessment(),
		}),
	);
	const session: Session = { ...baseSession(), ...first.patch, rev: 2 };
	const opportunity = session.opportunities[0];
	assert.ok(opportunity, 'discovery produced the template opportunity');
	const proposal: Proposal = {
		opportunityId: opportunity.id,
		graph: {
			steps: [
				{
					id: 'pstep_1',
					label: 'Automated entry',
					currentStepIds: ['step_a'],
					evidence: [
						{ sourceId: 'seg_a', sourceRev: 1, quote: 'receives' },
					],
				},
			],
			edges: [],
		},
		plan: {
			id: 'plan_1',
			status: 'draft',
			sections: {
				scope: 'Automate entry.',
				businessRules: 'Structured emails only.',
				integrationsAuth: 'Service account.',
				exceptions: 'Free text stays manual.',
				humanOversight: 'Clerk review.',
				milestones: 'Pilot first.',
				acceptanceTests: 'Samples match.',
			},
			editedSections: [],
		},
		mode: 'live',
		stale: false,
	};
	return { session, proposal };
}

test('renderPlanMarkdown emits sections in order with headings and provenance', async () => {
	const { session, proposal } = await sessionWithProposal();
	const markdown = renderPlanMarkdown(session, proposal);
	const headings = markdown
		.split('\n')
		.filter((line) => line.startsWith('## '))
		.map((line) => line.slice(3));
	assert.deepEqual(headings, [
		'Scope',
		'Business rules',
		'Integrations & auth',
		'Exceptions',
		'Human oversight',
		'Milestones',
		'Acceptance tests',
	]);
	assert.match(markdown, /^# Implementation plan — /m);
	assert.match(
		markdown,
		/> Provenance note: cited evidence establishes provenance, not factual certification\./,
	);
	assert.match(markdown, /- Status: draft/);
	// The plan download must not leak raw transcript text.
	assert.ok(!markdown.includes('The clerk receives the reservation email'));
	assert.ok(!markdown.includes('the clerk types the booking into the PMS'));
});

test('savings label: null inputs stay unestimated; filled inputs show the basis', async () => {
	const { session, proposal } = await sessionWithProposal();
	// Null out the discovered assumptions to force the unestimated label.
	const opportunity = session.opportunities[0];
	assert.ok(opportunity);
	const withNulls: Session = {
		...session,
		opportunities: session.opportunities.map((entry) =>
			entry.id === opportunity.id ?
				{
					...entry,
					assumptions: {
						monthlyOccurrences: {
							...entry.assumptions.monthlyOccurrences,
							value: null,
						},
						minutesSaved: {
							...entry.assumptions.minutesSaved,
							value: null,
						},
					},
					hoursSavedPerMonth: null,
				}
			:	entry,
		),
	};
	const unestimated = renderPlanMarkdown(withNulls, proposal);
	assert.match(
		unestimated,
		/Estimated savings: not yet estimated \(missing assumption inputs\)/,
	);

	const withNumbers: Session = {
		...session,
		opportunities: session.opportunities.map((entry) =>
			entry.id === opportunity.id ?
				{
					...entry,
					assumptions: {
						monthlyOccurrences: {
							...entry.assumptions.monthlyOccurrences,
							value: 120,
						},
						minutesSaved: {
							...entry.assumptions.minutesSaved,
							value: 45,
						},
					},
					hoursSavedPerMonth: (120 * 45) / 60,
				}
			:	entry,
		),
	};
	const estimated = renderPlanMarkdown(withNumbers, proposal);
	assert.match(
		estimated,
		/Estimated savings: 90 hours per month \(basis: 120 occurrences × 45 minutes per occurrence, from cited interview evidence\)/,
	);
});

test('renderPlanMarkdown throws when the proposal opportunity is missing', async () => {
	const { session, proposal } = await sessionWithProposal();
	assert.throws(
		() => renderPlanMarkdown({ ...session, opportunities: [] }, proposal),
		/Plan rendering requires the proposal's opportunity/,
	);
});
