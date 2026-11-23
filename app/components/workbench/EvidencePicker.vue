<script setup lang="ts">
	import {
		type EvidenceSource,
		evidenceKey,
	} from '../../composables/workbenchDescriptors';
	import type { EvidenceRef } from '#shared/p0/types';

	const props = defineProps<{ sources: EvidenceSource[] }>();
	const references = defineModel<EvidenceRef[]>({ required: true });
	const selectedId = ref('');
	const quote = ref('');
	const selected = computed(() =>
		props.sources.find((source) => source.id === selectedId.value),
	);
	const canAdd = computed(() =>
		Boolean(
			selected.value
			&& quote.value.trim()
			&& selected.value.text.includes(quote.value)
			&& !references.value.some(
				(ref) =>
					ref.sourceId === selected.value?.id
					&& ref.sourceRev === selected.value.sourceRev
					&& ref.quote === quote.value,
			),
		),
	);

	function addReference() {
		if (!selected.value || !canAdd.value) {
			return;
		}
		references.value = [
			...references.value,
			{
				sourceId: selected.value.id,
				sourceRev: selected.value.sourceRev,
				quote: quote.value,
			},
		];
		quote.value = '';
	}
</script>

<template>
	<div class="stack evidence-picker">
		<ul
			v-if="references.length"
			class="chosen"
		>
			<li
				v-for="(reference, index) in references"
				:key="evidenceKey(reference)"
			>
				<q>{{ reference.quote }}</q>
				<span
					v-if="
						!sources.some(
							(source) =>
								source.id === reference.sourceId
								&& source.sourceRev === reference.sourceRev
								&& source.text.includes(reference.quote),
						)
					"
					class="pill attention"
					>Source changed — replace citation</span
				>
				<button
					class="button"
					type="button"
					:aria-label="`Remove citation ${index + 1}`"
					@click="
						references = references.filter((_, at) => at !== index)
					"
				>
					Remove
				</button>
			</li>
		</ul>
		<details v-if="sources.length">
			<summary>Add a citation</summary>
			<div class="stack picker-fields">
				<label
					>Evidence source
					<select
						v-model="selectedId"
						@change="quote = ''"
					>
						<option value="">
							Choose a transcript row or answer
						</option>
						<option
							v-for="source in sources"
							:key="source.id"
							:value="source.id"
						>
							{{ source.label }}
						</option>
					</select>
				</label>
				<template v-if="selected">
					<p
						class="source-text preview"
						dir="auto"
					>
						{{ selected.text }}
					</p>
					<label
						>Verbatim quote
						<textarea
							v-model="quote"
							dir="auto"
							rows="2"
						/>
					</label>
					<p
						v-if="quote.trim() && !selected.text.includes(quote)"
						class="error-text fine"
					>
						The quote must match the source exactly.
					</p>
					<div class="actions">
						<button
							class="button"
							type="button"
							:disabled="!canAdd"
							@click="addReference"
						>
							Attach quote
						</button>
					</div>
				</template>
			</div>
		</details>
	</div>
</template>

<style scoped>
	.chosen {
		margin: 0;
		list-style: none;
		padding: 0;
	}
	.chosen li {
		display: grid;
		gap: 0.32rem;
		justify-items: start;
		margin-bottom: 0.45rem;
	}
	q {
		white-space: pre-wrap;
	}
	.picker-fields {
		margin-top: 0.5rem;
	}
	.preview {
		background: var(--soft);
		border-radius: 0.25rem;
		padding: 0.45rem;
		max-height: 8rem;
		overflow: auto;
	}
</style>
