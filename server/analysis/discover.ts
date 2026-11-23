// Discovery pipeline: project a bounded provider input, run the extract and
// assess stages, then reconcile validated candidates into session fields.
// Evidence is re-verified locally against the session's own sources; ambiguous
// or unsupported transitions are omitted from the graph and surfaced as review
// notices. Notices analysis does not own (answer/correction conflicts recorded
// by the storage seam) are carried forward so re-analysis cannot erase them.
import type { AssessOutput, ExtractOutput } from '../../shared/p0/stages';
import type {
	DiscoveryPatch,
	ReviewNotice,
	Session,
} from '../../shared/p0/types';
import {
	buildSourceIndex,
	parseAssessOutput,
	parseExtractOutput,
	resolveEvidence,
} from './validate';
import type { AnalysisProvider } from './provider';
import { StageError } from '../../shared/p0/stages';
import { projectExtractInput } from './project';
import { reconcileEdges } from './reconcile-edges';
import { reconcileOpportunities } from './reconcile-opportunities';
import { reconcileQuestions } from './reconcile-questions';
import { reconcileSteps } from './reconcile-steps';
import { runKey } from './keys';

export type DiscoveryResult = { patch: DiscoveryPatch; artifactKey: string };

/** Notice codes owned by the storage seam; discovery must preserve them. */
const STORAGE_OWNED_NOTICE_CODES: ReadonlySet<ReviewNotice['code']> = new Set([
	'answer_conflict',
	'correction_conflict',
]);

export async function discover(
	session: Session,
	provider: AnalysisProvider,
): Promise<DiscoveryResult> {
	const extractInput = projectExtractInput(session, provider);
	const extraction = parseExtractOutput(
		await provider.run('extract', extractInput),
	);

	const sources = buildSourceIndex(session);
	validateAllEvidence(extraction, sources);

	const assessment = parseAssessOutput(
		await provider.run('assess', {
			variant: extractInput.variant,
			clientId: extractInput.clientId,
			sessionId: extractInput.sessionId,
			sources: [...sources].map(([sourceId, source]) => ({
				id: sourceId,
				sourceRev: source.sourceRev,
				text: source.text,
			})),
			extraction,
		}),
	);
	assertKnownAssessmentKeys(assessment, extraction);

	const patch = reconcile(session, extraction, assessment, provider.mode);
	return { patch, artifactKey: runKey(session, 'discover', provider) };
}

function assertKnownAssessmentKeys(
	assessment: AssessOutput,
	extraction: ExtractOutput,
): void {
	const candidateKeys = new Set(
		extraction.transitions.map((transition) => transition.key),
	);
	for (const acceptedKey of assessment.acceptedTransitionKeys) {
		if (!candidateKeys.has(acceptedKey)) {
			throw new StageError(
				'invalid_model_output',
				`Assessment accepted unknown transition '${acceptedKey}'.`,
			);
		}
	}
	for (const rejected of assessment.rejected) {
		if (!candidateKeys.has(rejected.key)) {
			throw new StageError(
				'invalid_model_output',
				`Assessment rejected unknown transition '${rejected.key}'.`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Evidence gate
// ---------------------------------------------------------------------------

function validateAllEvidence(
	extraction: ExtractOutput,
	sources: ReturnType<typeof buildSourceIndex>,
): void {
	for (const step of extraction.steps) {
		for (const candidate of step.evidence) {
			resolveEvidence(candidate, sources);
		}
	}
	for (const transition of extraction.transitions) {
		resolveEvidence(transition.evidence, sources);
	}
	for (const opportunity of extraction.opportunities) {
		for (const candidate of opportunity.evidence) {
			resolveEvidence(candidate, sources);
		}
		for (const factor of opportunity.factors) {
			resolveEvidence(factor.evidence, sources);
		}
		for (const assumption of opportunity.assumptions) {
			resolveEvidence(assumption.evidence, sources);
		}
	}
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function reconcile(
	session: Session,
	extraction: ExtractOutput,
	assessment: AssessOutput,
	providerMode: 'fixture' | 'live',
): DiscoveryPatch {
	const derived: ReviewNotice[] = [];
	const addNotice = (notice: ReviewNotice) => {
		derived.push(notice);
	};

	const { steps, resolvedSteps } = reconcileSteps(
		session.workflow,
		extraction,
		addNotice,
	);
	const survivingStepIds = new Set(steps.map((step) => step.id));
	const edges = reconcileEdges(
		session.workflow,
		extraction,
		assessment,
		resolvedSteps,
		addNotice,
	);
	const questions = reconcileQuestions(
		session.questions,
		extraction,
		resolvedSteps,
		survivingStepIds,
		addNotice,
	);
	const opportunities = reconcileOpportunities(
		session.opportunities,
		extraction,
		resolvedSteps,
		survivingStepIds,
		addNotice,
	);

	return {
		workflow: { steps, edges },
		questions,
		opportunities,
		discovery: {
			mode: providerMode,
			completedAt: new Date().toISOString(),
			stale: false,
		},
		reviewNotices: mergeNotices(
			session.reviewNotices,
			assessment.notices,
			derived,
		),
	};
}

/**
 * Merge derived notices with provider-raised notices and the storage-owned
 * notices from the previous session state, deduplicated by code + message.
 */
function mergeNotices(
	previous: ReviewNotice[],
	providerNotices: AssessOutput['notices'],
	derived: ReviewNotice[],
): ReviewNotice[] {
	const merged = new Map<string, ReviewNotice>();
	for (const notice of derived) {
		merged.set(`${notice.code}|${notice.message}`, notice);
	}
	for (const notice of providerNotices) {
		merged.set(`${notice.code}|${notice.message}`, notice);
	}
	for (const notice of previous) {
		if (STORAGE_OWNED_NOTICE_CODES.has(notice.code)) {
			merged.set(`${notice.code}|${notice.message}`, notice);
		}
	}
	return [...merged.values()];
}

// Re-exported for the storage seam (assumption edits recompute savings).
export { computeHoursSaved } from './reconcile-opportunities';
