// Markdown rendering for plan downloads: status, opportunity, labeled savings,
// the seven named sections, and a provenance disclaimer. Never includes raw
// transcript text — sections cite evidence ids instead.
import type { PlanSection, Proposal, Session } from '../../shared/p0/types';

const SECTION_HEADINGS: Record<PlanSection, string> = {
	scope: 'Scope',
	businessRules: 'Business rules',
	integrationsAuth: 'Integrations & auth',
	exceptions: 'Exceptions',
	humanOversight: 'Human oversight',
	milestones: 'Milestones',
	acceptanceTests: 'Acceptance tests',
};

const SECTION_ORDER: PlanSection[] = [
	'scope',
	'businessRules',
	'integrationsAuth',
	'exceptions',
	'humanOversight',
	'milestones',
	'acceptanceTests',
];

export function renderPlanMarkdown(
	session: Session,
	proposal: Proposal,
): string {
	const opportunity = session.opportunities.find(
		(entry) => entry.id === proposal.opportunityId,
	);
	if (!opportunity) {
		throw new Error(
			`Plan rendering requires the proposal's opportunity '${proposal.opportunityId}'.`,
		);
	}
	const lines = [
		`# Implementation plan — ${opportunity.title}`,
		'',
		`- Opportunity: ${opportunity.id} (${opportunity.strategy})`,
		`- Plan: ${proposal.plan.id}`,
		`- Status: ${proposal.plan.status}`,
		`- Estimated savings: ${savingsLabel(opportunity.hoursSavedPerMonth, opportunity.assumptions)}`,
		'',
		'> Provenance note: cited evidence establishes provenance, not factual certification.',
		'',
	];
	for (const section of SECTION_ORDER) {
		lines.push(
			`## ${SECTION_HEADINGS[section]}`,
			'',
			proposal.plan.sections[section],
			'',
		);
	}
	return lines.join('\n');
}

function savingsLabel(
	hoursSavedPerMonth: number | null,
	assumptions: {
		monthlyOccurrences: { value: number | null };
		minutesSaved: { value: number | null };
	},
): string {
	if (hoursSavedPerMonth === null) {
		return 'not yet estimated (missing assumption inputs)';
	}
	const occurrences = assumptions.monthlyOccurrences.value ?? 'unknown';
	const minutes = assumptions.minutesSaved.value ?? 'unknown';
	return `${hoursSavedPerMonth} hours per month (basis: ${occurrences} occurrences × ${minutes} minutes per occurrence, from cited interview evidence)`;
}
