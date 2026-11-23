<script setup lang="ts">
	import type {
		EvidenceRef,
		Graph,
		ProposedGraph,
	} from '#shared/p0/types';
	import {
		currentDiagram,
		proposedDiagram,
	} from '../../composables/workflowDiagrams';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';
	import WorkflowDiagram from './WorkflowDiagram.vue';

	const props = defineProps<{
		current: Graph;
		proposed: ProposedGraph;
		sources: EvidenceSource[];
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const selectedCurrent = ref('');
	const selectedProposed = ref('');
	const currentGraph = computed(() => currentDiagram(props.current));
	const proposedGraph = computed(() =>
		proposedDiagram(props.proposed, props.current),
	);
</script>

<template>
	<section
		class="comparison"
		aria-labelledby="graph-comparison-heading"
	>
		<h3 id="graph-comparison-heading">Graph comparison</h3>
		<div class="comparison-grid">
			<section aria-label="Current workflow snapshot">
				<h4>Current workflow</h4>
				<p>Evidence-backed activities and handoffs.</p>
				<WorkflowDiagram
					:diagram="currentGraph"
					label="Current comparison diagram"
					:selected-id="selectedCurrent"
					:sources="sources"
					inspect
					@select="selectedCurrent = $event"
					@jump="emit('jump', $event)"
				/>
			</section>
			<section aria-label="Proposed workflow hypothesis">
				<h4>Proposed workflow · hypothesis</h4>
				<p>
					Evidence motivates changes; it does not prove they are in
					use.
				</p>
				<WorkflowDiagram
					:diagram="proposedGraph"
					label="Proposed comparison diagram"
					:selected-id="selectedProposed"
					:sources="sources"
					inspect
					@select="selectedProposed = $event"
					@jump="emit('jump', $event)"
				/>
			</section>
		</div>
	</section>
</template>

<style scoped>
	.comparison {
		margin-top: 1rem;
	}
	.comparison-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	h3 {
		margin: 0 0 0.62rem;
	}
	h4 {
		margin: 0 0 0.2rem;
	}
	p {
		color: var(--muted);
		font-size: 0.8rem;
		margin: 0 0 0.4rem;
	}
	@container (max-width: 37rem) {
		.comparison-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
