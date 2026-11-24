// Effort gate for the Shima tracer: the fixture accepts exactly the documented
// owner-reported datum on the documented step, cited with evidence that binds
// to the persisted follow-up answer. Any other shape is refused so the tracer
// cannot invent an effort basis.
import {
	SHIMA_EFFORT_MINUTES_PER_OCCURRENCE,
	SHIMA_EFFORT_STEP_ID,
	SHIMA_EFFORT_WEEKLY_OCCURRENCES,
} from '../demo/shima-quest';
import { assertEvidenceRefs, buildSourceIndex } from '../store/sources';
import type { Quantity } from '../../shared/shima/schemas';
import type { Session } from '../../shared/p0/types';
import { StageError } from '../../shared/p0/stages';
import { StoreInputError } from '../store/errors';

export type EffortInput = {
	weeklyOccurrences: Quantity;
	minutesPerOccurrence: Quantity;
};

/**
 * The fixture accepts exactly the documented owner-reported numbers. Any
 * other step, quantity kind, or value is unsupported.
 */
export function assertFixtureEffortInput(
	stepId: string,
	effort: EffortInput,
): void {
	if (stepId !== SHIMA_EFFORT_STEP_ID) {
		throw new StageError(
			'fixture_unsupported',
			`The fixture effort covers only step '${SHIMA_EFFORT_STEP_ID}'.`,
		);
	}
	if (
		!isOwnerReported(effort.weeklyOccurrences, SHIMA_EFFORT_WEEKLY_OCCURRENCES)
		|| !isOwnerReported(
			effort.minutesPerOccurrence,
			SHIMA_EFFORT_MINUTES_PER_OCCURRENCE,
		)
	) {
		throw new StageError(
			'fixture_unsupported',
			'The fixture accepts only the owner-reported weekly occurrences and minutes per occurrence.',
		);
	}
}

function isOwnerReported(quantity: Quantity, value: number): boolean {
	return (
		quantity.kind === 'owner-reported'
		&& quantity.value === value
		&& quantity.basis !== null
	);
}

/**
 * Submitted effort evidence must be boundary-valid against the session and at
 * least one reference must cite the persisted follow-up answer itself.
 */
export function assertFixtureEffortEvidence(
	session: Session,
	answerId: string,
	effort: EffortInput,
): void {
	const sources = buildSourceIndex(session);
	assertEvidenceRefs(effort.weeklyOccurrences.evidence, sources);
	assertEvidenceRefs(effort.minutesPerOccurrence.evidence, sources);
	const citesAnswer = [
		...effort.weeklyOccurrences.evidence,
		...effort.minutesPerOccurrence.evidence,
	].some((ref) => ref.sourceId === answerId);
	if (!citesAnswer) {
		throw new StoreInputError(
			'The effort datum must cite the documented follow-up answer.',
		);
	}
}
