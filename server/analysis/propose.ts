// Proposal pipeline: project the bounded propose input, run the propose stage,
// then assemble a persisted proposal (proposed graph + draft plan). All cited
// evidence is re-verified locally; proposed ids must map to real current steps.
import type { Id, Proposal, Session } from '../../shared/p0/types';
import {
	buildSourceIndex,
	parseProposeOutput,
	resolveEvidence,
} from './validate';
import type { AnalysisProvider } from './provider';
import { StageError } from '../../shared/p0/stages';
import { projectProposeInput } from './project';
import { runKey } from './keys';

export type ProposalResult = { proposal: Proposal; artifactKey: string };

export async function propose(
	session: Session,
	opportunityId: Id,
	provider: AnalysisProvider,
): Promise<ProposalResult> {
	const opportunity = session.opportunities.find(
		(entry) => entry.id === opportunityId,
	);
	if (!opportunity) {
		throw new StageError(
			'invalid_model_output',
			`Opportunity '${opportunityId}' not found.`,
		);
	}

	const proposeInput = projectProposeInput(session, opportunityId, provider);
	const output = parseProposeOutput(
		await provider.run('propose', proposeInput),
	);
	const proposal = assembleProposal(
		session,
		opportunityId,
		output,
		provider.mode,
	);
	return {
		proposal,
		artifactKey: runKey(session, 'propose', provider, opportunityId),
	};
}

type ProposeOutput = Awaited<ReturnType<typeof parseProposeOutput>>;

function assembleProposal(
	session: Session,
	opportunityId: Id,
	output: ProposeOutput,
	providerMode: 'fixture' | 'live',
): Proposal {
	const sources = buildSourceIndex(session);
	const currentStepIds = new Set(
		session.workflow.steps.map((step) => step.id),
	);

	const proposedKeys = new Set<string>();
	for (const step of output.steps) {
		if (proposedKeys.has(step.key)) {
			throw new StageError(
				'invalid_model_output',
				`Duplicate proposed step key '${step.key}'.`,
			);
		}
		proposedKeys.add(step.key);
		for (const currentId of step.currentStepIds) {
			if (!currentStepIds.has(currentId)) {
				throw new StageError(
					'invalid_model_output',
					`Proposed step '${step.key}' maps to unknown current step '${currentId}'.`,
				);
			}
		}
	}

	const proposedSteps = output.steps.map((step) => ({
		id: step.key,
		label: step.label,
		currentStepIds: [...step.currentStepIds],
		evidence: step.evidence.map((reference) =>
			resolveEvidence(reference, sources),
		),
	}));

	const proposedEdges = output.edges.map((edge) => {
		if (!proposedKeys.has(edge.fromKey) || !proposedKeys.has(edge.toKey)) {
			throw new StageError(
				'invalid_model_output',
				`Proposed edge '${edge.key}' connects steps outside the proposal.`,
			);
		}
		return {
			id: edge.key,
			fromStepId: edge.fromKey,
			toStepId: edge.toKey,
			label: edge.label,
			evidence: edge.evidence.map((reference) =>
				resolveEvidence(reference, sources),
			),
		};
	});

	// Regenerations keep the plan id and edited section text; approval resets.
	const existing = session.proposals.find(
		(entry) => entry.opportunityId === opportunityId,
	);
	const sections = { ...output.planSections };
	if (existing) {
		for (const editedSection of existing.plan.editedSections) {
			sections[editedSection] = existing.plan.sections[editedSection];
		}
	}

	return {
		opportunityId,
		graph: { steps: proposedSteps, edges: proposedEdges },
		plan: {
			id: existing?.plan.id ?? output.planKey,
			status: 'draft',
			sections,
			editedSections: existing ? [...existing.plan.editedSections] : [],
		},
		mode: providerMode,
		stale: false,
	};
}
