<script setup lang="ts">
	import { PLAN_SECTIONS, PLAN_STATUSES } from '#shared/p0/schemas';
	import type { Plan, PlanSection } from '#shared/p0/types';
	import {
		type PlanPatch,
		planHeadings,
	} from '../../composables/workbenchDescriptors';
	import { registerWorkbenchDraft } from '../../composables/useDraftProtection';

	const props = defineProps<{
		plan: Plan;
		stale: boolean;
		disabled: boolean;
		save: (patch: PlanPatch) => Promise<boolean>;
		download: () => Promise<boolean>;
	}>();
	const statusLabels = {
		draft: 'Draft',
		'in-review': 'In review',
		approved: 'Approved',
	} satisfies Record<Plan['status'], string>;
	const draft = ref({ ...props.plan.sections });
	const status = ref(props.plan.status);
	const editing = ref(false);
	const changedSections = computed(() =>
		PLAN_SECTIONS.filter(
			(section) => draft.value[section] !== props.plan.sections[section],
		),
	);
	const draftStatusChanged = computed(
		() => status.value !== props.plan.status,
	);
	const remoteConflict = ref<PlanSection[]>([]);
	const overwrite = ref(false);
	const dirty = computed(
		() =>
			(editing.value && changedSections.value.length > 0)
			|| draftStatusChanged.value,
	);
	registerWorkbenchDraft(dirty);
	defineExpose({ dirty });

	watch(
		() => props.plan,
		(next, previous) => {
			for (const section of PLAN_SECTIONS) {
				if (
					!editing.value
					|| draft.value[section] === previous.sections[section]
				) {
					draft.value[section] = next.sections[section];
				} else if (
					next.sections[section] !== previous.sections[section]
					&& draft.value[section] !== next.sections[section]
					&& !remoteConflict.value.includes(section)
				) {
					remoteConflict.value.push(section);
					overwrite.value = false;
				}
			}
			if (status.value === previous.status) {
				status.value = next.status;
			}
		},
	);

	function cancel() {
		draft.value = { ...props.plan.sections };
		remoteConflict.value = [];
		overwrite.value = false;
		editing.value = false;
	}
	async function saveSections() {
		const sections: Partial<Plan['sections']> = {};
		for (const section of changedSections.value) {
			sections[section] = draft.value[section];
		}
		if (await props.save({ sections })) {
			cancel();
		}
	}
	async function saveStatus() {
		if (props.stale && status.value === 'approved') {
			return;
		}
		if (await props.save({ status: status.value })) {
			status.value = props.plan.status;
		}
	}
</script>

<template>
	<section
		class="plan-editor"
		aria-labelledby="plan-editor-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">Consultant deliverable</p>
				<h3 id="plan-editor-heading">Implementation plan</h3>
			</div>
			<p class="pill">{{ statusLabels[plan.status] }}</p>
		</div>
		<p
			v-if="stale"
			class="pill attention"
		>
			Plan is out of date. Refresh discovery or regenerate this proposal
			before approval or export.
		</p>
		<p class="quiet fine">
			Review status records consultant sign-off only; it does not deploy
			or run an automation.
		</p>
		<div class="actions plan-tools">
			<button
				v-if="!editing"
				class="button"
				type="button"
				@click="editing = true"
			>
				Edit plan sections
			</button>
			<button
				class="button"
				type="button"
				:disabled="
					disabled || stale || (editing && !!changedSections.length)
				"
				@click="download"
			>
				Download Markdown
			</button>
		</div>
		<form
			v-if="editing"
			class="stack"
			@submit.prevent="saveSections"
		>
			<p class="quiet fine">
				Saving changed text resets this plan to draft. Edited sections
				are carried into regeneration.
			</p>
			<label
				v-for="section in PLAN_SECTIONS"
				:key="section"
				>{{ planHeadings[section] }}
				<textarea
					v-model="draft[section]"
					rows="4"
					dir="auto"
				/>
			</label>
			<div
				v-if="remoteConflict.length"
				class="remote stack"
			>
				<p>The saved version changed while you were editing:</p>
				<dl>
					<div
						v-for="section in remoteConflict"
						:key="section"
					>
						<dt>{{ planHeadings[section] }}</dt>
						<dd>{{ plan.sections[section] }}</dd>
					</div>
				</dl>
				<label
					><input
						v-model="overwrite"
						type="checkbox"
					/>
					Replace these saved sections with my draft.</label
				>
			</div>
			<div class="actions">
				<button
					class="button primary"
					type="submit"
					:disabled="
						disabled
						|| !changedSections.length
						|| (!!remoteConflict.length && !overwrite)
					"
				>
					Save plan sections</button
				><button
					class="button"
					type="button"
					@click="cancel"
				>
					Cancel editing
				</button>
			</div>
		</form>
		<template v-else>
			<details
				v-for="(section, index) in PLAN_SECTIONS"
				:key="section"
				class="plan-section"
				:open="index === 0 || undefined"
			>
				<summary>
					{{ planHeadings[section] }}
					<span
						v-if="plan.editedSections.includes(section)"
						class="pill"
						>Edited</span
					>
				</summary>
				<p dir="auto">
					{{ plan.sections[section] || 'No content yet.' }}
				</p>
			</details>
		</template>
		<form
			class="actions status-form"
			@submit.prevent="saveStatus"
		>
			<label
				>Review status<select v-model="status">
					<option
						v-for="choice in PLAN_STATUSES"
						:key="choice"
						:value="choice"
						:disabled="stale && choice === 'approved'"
					>
						{{ statusLabels[choice] }}
					</option>
				</select></label
			>
			<button
				class="button"
				type="submit"
				:disabled="
					disabled
					|| !draftStatusChanged
					|| (editing && !!changedSections.length)
					|| (stale && status === 'approved')
				"
			>
				Save review status
			</button>
		</form>
	</section>
</template>

<style scoped>
	.plan-editor {
		border-top: 1px solid var(--line);
		margin-top: 1rem;
		padding-top: 0.85rem;
	}
	.panel-header h3 {
		margin: 0.2rem 0 0;
	}
	.plan-tools {
		margin-bottom: 0.75rem;
	}
	.plan-section {
		padding: 0.55rem 0;
		border-top: 1px solid var(--line);
	}
	.plan-section p,
	dd {
		white-space: pre-wrap;
		margin: 0.4rem 0 0;
	}
	.status-form {
		margin-top: 0.9rem;
		align-items: end;
	}
	.remote {
		background: var(--sand);
		padding: 0.65rem;
		border-radius: 0.3rem;
	}
	.remote dl,
	.remote p {
		margin: 0;
	}
</style>
