import type {
	EvidenceRef,
	Opportunity,
	Plan,
	PlanSection,
	Session,
	Step,
} from '#shared/p0/types';

export type StepField = keyof Omit<Step, 'id' | 'graphEligible'>;
export const stepFields = {
	label: 'Step name',
	role: 'Role',
	tool: 'Tool',
	inputs: 'Inputs',
	outputs: 'Outputs',
	execution: 'Execution',
	bottleneck: 'Bottleneck',
	exception: 'Exception',
} satisfies Record<StepField, string>;
export type StepPatch = Partial<{
	[Field in StepField]: Pick<Step[Field], 'value' | 'evidence'>;
}>;
export type AssumptionKey = keyof Opportunity['assumptions'];
export type AssumptionsPatch = Partial<{
	[Field in AssumptionKey]: Omit<Opportunity['assumptions'][Field], 'edited'>;
}>;
export type PlanPatch = {
	sections?: Partial<Plan['sections']>;
	status?: Plan['status'];
};
export const planHeadings = {
	scope: 'Scope',
	businessRules: 'Business rules',
	integrationsAuth: 'Integrations & auth',
	exceptions: 'Exceptions',
	humanOversight: 'Human oversight',
	milestones: 'Milestones',
	acceptanceTests: 'Acceptance tests',
} satisfies Record<PlanSection, string>;

export type EvidenceSource = {
	id: string;
	sourceRev: number;
	text: string;
	label: string;
};

export function evidenceSources(session: Session): EvidenceSource[] {
	return [
		...(session.transcript?.segments ?? []).map((segment, index) => ({
			id: segment.id,
			sourceRev: segment.sourceRev,
			text: segment.text,
			label: `${String(index + 1).padStart(2, '0')} · ${segment.speaker || 'Speaker not recorded'}`,
		})),
		...session.questions.flatMap(({ answer, prompt }) =>
			answer ? [{ ...answer, label: `Answer · ${prompt}` }] : [],
		),
	];
}

export function evidenceKey(reference: EvidenceRef): string {
	return `${reference.sourceId}:${reference.sourceRev}:${reference.quote}`;
}

export function claimStateLabel(state: Step['label']['state']): string {
	return {
		'client-confirmed': 'Client confirmed',
		inferred: 'Inferred',
		unknown: 'Unknown',
		'consultant-verified': 'Consultant verified',
	}[state];
}

export function displayClaim(value: Step[StepField]['value']): string {
	if (value === null) {
		return 'Not established';
	}
	if (Array.isArray(value)) {
		return value.join(' · ') || 'None recorded';
	}
	return value;
}
