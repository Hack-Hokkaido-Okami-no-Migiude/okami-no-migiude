// Apply a consultant correction to one workflow step. Only the submitted claims
// are replaced; every submitted value must carry evidence that validates at the
// boundary, `verify: true` records the claim as consultant-verified, and a
// submitted null value clears the claim back to unknown.
import type { EvidenceRef, Step } from '../../shared/p0/types';
import { type SourceIndex, assertEvidenceRefs } from './sources';
import {
	consultantExecutionClaim,
	consultantStringClaim,
	consultantStringListClaim,
} from './claims';
import { StoreInputError } from './errors';

export type CorrectionField<TValue> = {
	value: TValue;
	evidence: EvidenceRef[];
};

export type CorrectionFields = {
	label?: CorrectionField<string | null>;
	role?: CorrectionField<string | null>;
	tool?: CorrectionField<string | null>;
	inputs?: CorrectionField<string[] | null>;
	outputs?: CorrectionField<string[] | null>;
	execution?: CorrectionField<'manual' | 'automated' | 'mixed' | null>;
	bottleneck?: CorrectionField<string | null>;
	exception?: CorrectionField<string | null>;
};

export function applyStepCorrection(
	step: Step,
	fields: CorrectionFields,
	verify: boolean,
	sources: SourceIndex,
): Step {
	const next: Step = { ...step };
	const rejectEvidenceOnCleared = (field: {
		value: unknown;
		evidence: EvidenceRef[];
	}) => {
		if (field.value === null && field.evidence.length > 0) {
			throw new StoreInputError(
				'A cleared step field must not carry evidence references.',
			);
		}
		if (field.value !== null && field.evidence.length === 0) {
			throw new StoreInputError(
				'A submitted step field value requires at least one evidence reference.',
			);
		}
	};
	const submitText = (
		field: CorrectionField<string | null>,
		claim: 'label' | 'role' | 'tool' | 'bottleneck' | 'exception',
	) => {
		assertEvidenceRefs(field.evidence, sources);
		rejectEvidenceOnCleared(field);
		next[claim] = consultantStringClaim(
			field.value,
			field.evidence,
			verify,
		);
	};

	if (fields.label) {
		submitText(fields.label, 'label');
	}
	if (fields.role) {
		submitText(fields.role, 'role');
	}
	if (fields.tool) {
		submitText(fields.tool, 'tool');
	}
	if (fields.inputs) {
		assertEvidenceRefs(fields.inputs.evidence, sources);
		rejectEvidenceOnCleared(fields.inputs);
		next.inputs = consultantStringListClaim(
			fields.inputs.value,
			fields.inputs.evidence,
			verify,
		);
	}
	if (fields.outputs) {
		assertEvidenceRefs(fields.outputs.evidence, sources);
		rejectEvidenceOnCleared(fields.outputs);
		next.outputs = consultantStringListClaim(
			fields.outputs.value,
			fields.outputs.evidence,
			verify,
		);
	}
	if (fields.execution) {
		assertEvidenceRefs(fields.execution.evidence, sources);
		rejectEvidenceOnCleared(fields.execution);
		next.execution = consultantExecutionClaim(
			fields.execution.value,
			fields.execution.evidence,
			verify,
		);
	}
	if (fields.bottleneck) {
		submitText(fields.bottleneck, 'bottleneck');
	}
	if (fields.exception) {
		submitText(fields.exception, 'exception');
	}
	// A step without a known label cannot be drawn on the graph; keep the
	// invariant the citation cascade and the discovery refresh also maintain.
	next.graphEligible = next.label.value !== null;
	return next;
}
