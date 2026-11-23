<script setup lang="ts">
	import type { EvidenceRef, Step } from '#shared/p0/types';
	import {
		type EvidenceSource,
		type StepField,
		type StepPatch,
		claimStateLabel,
		displayClaim,
		stepFields,
	} from '../../composables/workbenchDescriptors';
	import { EXECUTION_MODES } from '#shared/p0/schemas';
	import EvidenceLinks from './EvidenceLinks.vue';
	import EvidencePicker from './EvidencePicker.vue';
	import { registerWorkbenchDraft } from '../../composables/useDraftProtection';

	const props = defineProps<{
		step: Step;
		sources: EvidenceSource[];
		disabled: boolean;
		reviewOnly: boolean;
		save: (
			id: string,
			fields: StepPatch,
			verify: boolean,
		) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const fields = Object.keys(stepFields) as StepField[];
	const editing = ref<StepField | null>(null);
	const text = ref('');
	const execution = ref<NonNullable<Step['execution']['value']> | ''>('');
	const attached = ref<EvidenceRef[]>([]);
	const baseline = ref('');
	const error = ref('');
	const activeClaim = computed(() =>
		editing.value ? props.step[editing.value] : null,
	);
	const currentValue = computed(() =>
		Array.isArray(activeClaim.value?.value) ?
			activeClaim.value.value.join('\n')
		:	(activeClaim.value?.value ?? ''),
	);
	const dirty = computed(
		() =>
			editing.value !== null
			&& JSON.stringify([text.value, execution.value, attached.value])
				!== baseline.value,
	);
	registerWorkbenchDraft(dirty);
	defineExpose({ dirty });

	function start(field: StepField) {
		if (
			dirty.value
			&& !window.confirm('Discard edits to the current finding field?')
		) {
			return;
		}
		editing.value = field;
		text.value = currentValue.value;
		execution.value =
			field === 'execution' ? (props.step.execution.value ?? '') : '';
		attached.value = [...props.step[field].evidence];
		baseline.value = JSON.stringify([
			text.value,
			execution.value,
			attached.value,
		]);
		error.value = '';
	}

	async function submit(verify: boolean) {
		const field = editing.value;
		if (!field || props.disabled) {
			return;
		}
		const evidence = attached.value;
		const value = text.value.trim() ? text.value : null;
		const editedValue =
			field === 'execution' ? execution.value || null : value;
		error.value = '';
		if (verify && editedValue === null) {
			error.value = 'An unknown value cannot be verified.';
		} else if (editedValue !== null && !evidence.length) {
			error.value =
				'Attach at least one verbatim citation that supports this value.';
		} else if (
			editedValue !== null
			&& evidence.some(
				(ref) =>
					!props.sources.some(
						(source) =>
							source.id === ref.sourceId
							&& source.sourceRev === ref.sourceRev
							&& source.text.includes(ref.quote),
					),
			)
		) {
			error.value =
				'Replace citations whose source changed before saving.';
		}
		if (error.value) {
			return;
		}
		const validEvidence = editedValue === null ? [] : evidence;
		let patch: StepPatch;
		if (field === 'execution') {
			patch = {
				execution: {
					value: execution.value || null,
					evidence: validEvidence,
				},
			};
		} else if (field === 'inputs' || field === 'outputs') {
			patch = {
				[field]: {
					value:
						value?.split(/\r?\n/u).filter((line) => line.trim())
						?? null,
					evidence: validEvidence,
				},
			};
		} else {
			patch = { [field]: { value, evidence: validEvidence } };
		}
		if (await props.save(props.step.id, patch, verify)) {
			editing.value = null;
		}
	}
</script>

<template>
	<div class="finding">
		<h3>{{ step.label.value ?? 'Unnamed finding' }}</h3>
		<p
			v-if="reviewOnly"
			class="pill attention"
		>
			Review only · not part of the diagram
		</p>
		<p class="fine quiet">
			Evidence traces a claim to its source; review whether the wording
			supports the claim before verifying.
		</p>
		<dl class="claim-list">
			<div
				v-for="field in fields"
				:key="field"
				class="claim"
			>
				<dt>
					<strong>{{ stepFields[field] }}</strong><span
						class="pill"
						:class="{ attention: step[field].state === 'inferred' }"
						>{{ claimStateLabel(step[field].state) }}</span
					>
				</dt>
				<dd>
					<p
						class="claim-value"
						dir="auto"
					>
						{{ displayClaim(step[field].value) }}
					</p>
					<p
						v-if="step[field].inference"
						class="quiet fine"
					>
						Inference: {{ step[field].inference }}
					</p>
					<p
						v-if="
							step[field].author === 'consultant'
							&& step[field].state !== 'consultant-verified'
						"
						class="quiet fine"
					>
						Consultant correction · not verified
					</p>
					<EvidenceLinks
						:references="step[field].evidence"
						:sources="sources"
						compact
						@jump="emit('jump', $event)"
					/>
					<button
						v-if="editing !== field"
						class="button edit-claim"
						type="button"
						@click="start(field)"
					>
						Review {{ stepFields[field].toLowerCase() }}
					</button>
					<form
						v-else
						class="claim-edit stack"
						@submit.prevent="submit(false)"
					>
						<label v-if="field === 'execution'"
							>Execution value
							<select v-model="execution">
								<option value="">Unknown</option>
								<option
									v-for="mode in EXECUTION_MODES"
									:key="mode"
									:value="mode"
								>
									{{ mode }}
								</option>
							</select>
						</label>
						<label v-else
							>{{ stepFields[field] }} value
							<textarea
								v-model="text"
								dir="auto"
								rows="2"
							/>
						</label>
						<p class="quiet fine">
							{{
								field === 'inputs' || field === 'outputs' ?
									'One item per line. '
								:	''
							}}A blank value is unknown.
						</p>
						<EvidencePicker
							v-model="attached"
							:sources="sources"
						/>
						<p
							v-if="error"
							class="error-text fine"
							role="alert"
						>
							{{ error }}
						</p>
						<div class="actions">
							<button
								class="button"
								type="submit"
								:disabled="disabled"
							>
								Save correction
							</button>
							<button
								class="button primary"
								type="button"
								:disabled="disabled"
								@click="submit(true)"
							>
								Verify finding field
							</button>
							<button
								class="button"
								type="button"
								@click="editing = null"
							>
								Cancel
							</button>
						</div>
					</form>
				</dd>
			</div>
		</dl>
	</div>
</template>

<style scoped>
	.finding > h3 {
		margin: 0 0 0.5rem;
	}
	.claim-list {
		padding: 0;
		margin: 0;
	}
	.claim {
		border-top: 1px solid var(--line);
		padding: 0.7rem 0;
	}
	dt {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.4rem;
	}
	dd {
		margin: 0;
	}
	dd p {
		margin: 0.25rem 0;
	}
	.claim-value {
		white-space: pre-wrap;
	}
	.edit-claim {
		margin-top: 0.4rem;
	}
	.claim-edit {
		background: var(--paper);
		padding: 0.55rem;
		margin-top: 0.45rem;
		border-radius: 0.35rem;
	}
	.claim-edit p {
		margin: 0;
	}
</style>
