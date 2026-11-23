<script setup lang="ts">
	import {
		type EvidenceSource,
		evidenceKey,
	} from '../../composables/workbenchDescriptors';
	import type { EvidenceRef } from '#shared/p0/types';

	const props = defineProps<{
		references: EvidenceRef[];
		sources: EvidenceSource[];
		compact?: boolean;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const entries = computed(() =>
		props.references.map((reference) => ({
			reference,
			source: props.sources.find(
				(source) =>
					source.id === reference.sourceId
					&& source.sourceRev === reference.sourceRev
					&& source.text.includes(reference.quote),
			),
		})),
	);
</script>

<template>
	<ul
		v-if="entries.length"
		class="citations"
		aria-label="Source citations"
	>
		<li
			v-for="{ reference, source } in entries"
			:key="evidenceKey(reference)"
		>
			<button
				v-if="source"
				type="button"
				class="citation"
				@click="emit('jump', reference)"
			>
				<span class="citation-label"
					>{{ compact ? 'View source' : source.label }}
					<span aria-hidden="true">↗</span></span
				>
				<q>{{ reference.quote }}</q>
			</button>
			<p
				v-else
				class="quiet fine"
			>
				Source changed or is no longer available.
			</p>
		</li>
	</ul>
</template>

<style scoped>
	.citations {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: grid;
		gap: 0.35rem;
	}
	.citation {
		padding: 0.48rem 0.55rem;
		width: 100%;
		text-align: left;
		background: var(--soft);
		color: var(--pine);
		border: 1px solid transparent;
		border-radius: 0.35rem;
	}
	.citation:hover {
		border-color: var(--pine);
	}
	.citation-label {
		display: block;
		font-weight: 700;
		font-size: 0.75rem;
		margin-bottom: 0.18rem;
	}
	q {
		font-weight: 400;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
