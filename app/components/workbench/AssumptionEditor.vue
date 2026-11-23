<script setup lang="ts">
	import type { Assumption, EvidenceRef } from '#shared/p0/types';
	import EvidenceLinks from './EvidenceLinks.vue';
	import EvidencePicker from './EvidencePicker.vue';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';
	import { registerWorkbenchDraft } from '../../composables/useDraftProtection';

	const props = defineProps<{
		label: string;
		assumption: Assumption;
		sources: EvidenceSource[];
		disabled: boolean;
		save: (assumption: Omit<Assumption, 'edited'>) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const editing = ref(false);
	const value = ref<number | ''>('');
	const basis = ref('');
	const evidence = ref<EvidenceRef[]>([]);
	const baseline = ref('');
	const packed = computed(() =>
		JSON.stringify([
			value.value === '' ? null : value.value,
			basis.value,
			evidence.value,
		]),
	);
	const dirty = computed(
		() => editing.value && baseline.value !== packed.value,
	);
	const changedElsewhere = computed(
		() =>
			editing.value
			&& baseline.value
				!== JSON.stringify([
					props.assumption.value,
					props.assumption.basis,
					props.assumption.evidence,
				]),
	);
	const validEvidence = computed(() =>
		evidence.value.every((ref) =>
			props.sources.some(
				(source) =>
					source.id === ref.sourceId
					&& source.sourceRev === ref.sourceRev
					&& source.text.includes(ref.quote),
			),
		),
	);
	registerWorkbenchDraft(dirty);
	defineExpose({ dirty });

	function start() {
		value.value = props.assumption.value ?? '';
		basis.value = props.assumption.basis;
		evidence.value = [...props.assumption.evidence];
		baseline.value = packed.value;
		editing.value = true;
	}
	async function submit() {
		const assumption = {
			value: value.value === '' ? null : value.value,
			basis: basis.value,
			evidence: evidence.value,
		};
		if (
			dirty.value
			&& validEvidence.value
			&& assumption.basis.trim()
			&& (await props.save(assumption))
		) {
			editing.value = false;
		}
	}
</script>

<template>
	<div class="assumption">
		<h4>
			{{ label }}
			<span class="pill">{{ assumption.value ?? 'Unknown' }}</span>
		</h4>
		<p class="quiet fine">
			{{ assumption.edited ? 'Consultant estimate · ' : ''
			}}{{ assumption.basis }}
		</p>
		<EvidenceLinks
			:references="assumption.evidence"
			:sources="sources"
			compact
			@jump="emit('jump', $event)"
		/>
		<form
			v-if="editing"
			class="stack assumption-edit"
			@submit.prevent="submit"
		>
			<label
				>{{ label }} estimate
				<input
					v-model.number="value"
					type="number"
					min="0"
					step="any"
					placeholder="Unknown"
			/></label>
			<label
				>Basis for {{ label.toLowerCase() }}
				<textarea
					v-model="basis"
					rows="2"
					dir="auto"
					required
				/>
			</label>
			<p class="fine quiet">
				Leave the estimate blank for unknown; zero is a valid estimate.
			</p>
			<p
				v-if="changedElsewhere"
				class="pill attention"
			>
				The saved estimate changed. Compare with the saved values above
				before applying this draft.
			</p>
			<EvidencePicker
				v-model="evidence"
				:sources="sources"
			/>
			<div class="actions">
				<button
					class="button primary"
					type="submit"
					:disabled="
						disabled || !dirty || !validEvidence || !basis.trim()
					"
				>
					Save {{ label.toLowerCase() }}</button
				><button
					class="button"
					type="button"
					@click="editing = false"
				>
					Cancel
				</button>
			</div>
		</form>
		<button
			v-else
			class="button assumption-edit"
			type="button"
			@click="start"
		>
			Edit {{ label.toLowerCase() }}
		</button>
	</div>
</template>

<style scoped>
	.assumption {
		padding: 0.55rem 0;
		border-top: 1px solid var(--line);
	}
	h4,
	p {
		margin: 0 0 0.3rem;
	}
	.assumption-edit {
		margin-top: 0.45rem;
	}
</style>
