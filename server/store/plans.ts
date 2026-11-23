// Apply a plan review/edit patch: supplied section texts are merged, edited
// sections are tracked across regenerations, and the resulting status resolves
// as explicit status first, otherwise draft when any text changed.
import type { Plan, PlanSection } from '../../shared/p0/types';

export type PlanPatch = {
	sections?: Partial<Record<PlanSection, string>>;
	status?: Plan['status'];
};

export function applyPlanPatch(
	plan: Plan,
	patch: PlanPatch,
): { plan: Plan; textChanged: boolean } {
	const sections = { ...plan.sections };
	const editedSections = new Set(plan.editedSections);
	let textChanged = false;

	if (patch.sections) {
		for (const [section, text] of Object.entries(patch.sections) as [
			PlanSection,
			string,
		][]) {
			if (sections[section] === text) {
				continue;
			}
			sections[section] = text;
			editedSections.add(section);
			textChanged = true;
		}
	}

	const status: Plan['status'] =
		patch.status ?? (textChanged ? 'draft' : plan.status);
	return {
		plan: {
			id: plan.id,
			status,
			sections,
			editedSections: [...editedSections],
		},
		textChanged,
	};
}
