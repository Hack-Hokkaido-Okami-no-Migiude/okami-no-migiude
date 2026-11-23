// Question reconciliation: new open questions come from extraction unknowns,
// keyed by reconciled target + fact key so the same unknown is never duplicated
// — an answered question suppresses re-asking that fact/target even when the
// provider paraphrases the prompt. Questions whose target step disappeared are
// retired (or detached when answered) so the session stays valid and history
// is kept.
import type { Question, ReviewNotice } from '../../shared/p0/types';
import type { ExtractOutput } from '../../shared/p0/stages';
import type { ResolvedStep } from './reconcile-steps';
import { StageError } from '../../shared/p0/stages';
import { assertLocalKeyPrefix } from './validate';

export function reconcileQuestions(
	existing: Question[],
	extraction: ExtractOutput,
	resolvedSteps: Map<string, ResolvedStep>,
	survivingStepIds: ReadonlySet<string>,
	addNotice: (notice: ReviewNotice) => void,
): Question[] {
	// Detach or retire questions whose target step is gone from the graph.
	const questions: Question[] = existing.map((question) => {
		if (
			question.targetStepId === null
			|| survivingStepIds.has(question.targetStepId)
		) {
			return question;
		}
		if (question.status === 'open') {
			addNotice({
				code: 'lost_evidence',
				targetId: question.id,
				message: `Question '${question.prompt}' targets a step that is no longer part of the graph and was retired.`,
			});
			return { ...question, targetStepId: null, status: 'retired' };
		}
		// Answered history stays valid: the answer itself remains citable evidence.
		return { ...question, targetStepId: null };
	});

	const seen = new Set(
		questions.map(
			(question) => `${question.targetStepId ?? ''}|${question.factKey}`,
		),
	);
	const usedIds = new Set(questions.map((question) => question.id));

	for (const candidate of extraction.unknowns) {
		const targetStepId =
			candidate.stepKey === null ?
				null
			:	resolvedStepIdOrNull(
					resolvedSteps,
					candidate.stepKey,
					candidate.key,
				);
		const compositeKey = `${targetStepId ?? ''}|${candidate.factKey}`;
		if (seen.has(compositeKey)) {
			// Same reconciled target + fact key already exists (possibly answered):
			// keep its history instead of duplicating the question.
			continue;
		}
		seen.add(compositeKey);
		if (usedIds.has(candidate.key)) {
			throw new StageError(
				'invalid_model_output',
				`Local key '${candidate.key}' collides with an existing question id.`,
			);
		}
		usedIds.add(candidate.key);
		assertLocalKeyPrefix(candidate.key, 'q', 'extracted question');
		questions.push({
			id: candidate.key,
			targetStepId,
			factKey: candidate.factKey,
			prompt: candidate.prompt,
			whyItMatters: candidate.whyItMatters,
			priority: candidate.priority,
			status: 'open',
			answer: null,
		});
	}
	return questions;
}

function resolvedStepIdOrNull(
	resolvedSteps: Map<string, ResolvedStep>,
	stepKey: string,
	candidateKey: string,
): string | null {
	const resolved = resolvedSteps.get(stepKey);
	if (!resolved) {
		throw new StageError(
			'invalid_model_output',
			`Candidate '${candidateKey}' references a step outside the extraction ('${stepKey}').`,
		);
	}
	return 'omitted' in resolved ? null : resolved.id;
}
