<script setup lang="ts">
	import type {
		Diagram,
		DiagramEdge,
	} from '../../composables/workflowDiagrams';
	import EvidenceLinks from './EvidenceLinks.vue';
	import type { EvidenceRef } from '#shared/p0/types';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';

	const props = defineProps<{
		diagram: Diagram;
		label: string;
		selectedId: string;
		sources: EvidenceSource[];
		inspect?: boolean;
	}>();
	const emit = defineEmits<{
		select: [id: string];
		jump: [reference: EvidenceRef];
	}>();
	const edgeLabels = {
		sequence: 'Sequence',
		decision: 'Decision',
		exception: 'Exception',
		hypothesis: 'Hypothesis',
	} satisfies Record<DiagramEdge['kind'], string>;
	const rows = computed(() => {
		const nodeIndex = new Map(
			props.diagram.nodes.map((node, index) => [
				node.id,
				{ node, index },
			]),
		);
		const outgoing = new Map<
			string,
			{ edge: DiagramEdge; target: string }[]
		>();
		for (const edge of props.diagram.edges) {
			const target = nodeIndex.get(edge.toStepId);
			if (!target) {
				continue;
			}
			const connections = outgoing.get(edge.fromStepId) ?? [];
			connections.push({
				edge,
				target: `${target.index + 1}. ${target.node.label}`,
			});
			outgoing.set(edge.fromStepId, connections);
		}
		return props.diagram.nodes.map((node, index) => ({
			node,
			number: String(index + 1).padStart(2, '0'),
			outgoing: outgoing.get(node.id) ?? [],
		}));
	});
	const edgeCount = computed(() => props.diagram.edges.length);
</script>

<template>
	<div
		class="diagram"
		role="group"
		:aria-label="label"
	>
		<p
			v-if="!rows.length"
			class="empty"
		>
			No supported steps to draw yet.
		</p>
		<template v-else>
			<p class="diagram-caption fine quiet">
				{{ rows.length }} {{ rows.length === 1 ? 'step' : 'steps' }} ·
				{{ edgeCount }}
				{{ edgeCount === 1 ? 'transition' : 'transitions' }}
				<span v-if="!inspect">· select to inspect</span>
			</p>
			<ol
				class="diagram-rows"
				role="list"
			>
				<li
					v-for="{ node, number, outgoing } in rows"
					:key="node.id"
					class="diagram-row"
				>
					<button
						class="node"
						type="button"
						:aria-pressed="selectedId === node.id"
						@click="emit('select', node.id)"
					>
						<span
							class="node-index mono"
							aria-hidden="true"
							>{{ number }}</span
						>
						<span
							><strong>{{ node.label }}</strong
							><small>{{ node.detail }}</small></span
						>
					</button>
					<EvidenceLinks
						v-if="inspect && selectedId === node.id"
						:references="node.evidence"
						:sources="sources"
						compact
						@jump="emit('jump', $event)"
					/>
					<ul
						v-if="outgoing.length"
						class="transitions"
						:aria-label="`Transitions from ${node.label}`"
					>
						<li
							v-for="{ edge, target } in outgoing"
							:key="edge.id"
						>
							<button
								type="button"
								class="edge"
								:data-kind="edge.kind"
								:aria-pressed="selectedId === edge.id"
								:aria-label="`${edgeLabels[edge.kind]} from ${node.label} to ${target}${edge.label ? `: ${edge.label}` : ''}`"
								@click="emit('select', edge.id)"
							>
								<span
									class="arrow"
									aria-hidden="true"
									>↳</span
								><span
									><b>{{ edgeLabels[edge.kind] }}</b> →
									{{ target
									}}<small v-if="edge.label">{{
										edge.label
									}}</small></span
								>
							</button>
							<EvidenceLinks
								v-if="inspect && selectedId === edge.id"
								:references="edge.evidence"
								:sources="sources"
								compact
								@jump="emit('jump', $event)"
							/>
						</li>
					</ul>
				</li>
			</ol>
		</template>
	</div>
</template>

<style scoped>
	.diagram {
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background-color: var(--paper);
		background-image: radial-gradient(#d3dacc 1px, transparent 1px);
		background-size: 13px 13px;
		padding: 0.65rem;
	}
	.diagram-caption {
		background: var(--paper);
		margin: 0 0 0.45rem;
	}
	.diagram-rows {
		list-style: none;
		padding: 0 0.2rem 0 0;
		margin: 0;
		display: grid;
		gap: 0.7rem;
		max-height: 34.5rem;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.diagram-row {
		min-width: 0;
	}
	.node,
	.edge {
		display: flex;
		align-items: start;
		width: 100%;
		gap: 0.55rem;
		text-align: left;
		border: 1px solid #afbaad;
		color: var(--pine);
		border-radius: 0.35rem;
		background: var(--surface);
		padding: 0.53rem;
	}
	.node:hover,
	.edge:hover {
		border-color: var(--pine);
	}
	.node[aria-pressed='true'],
	.edge[aria-pressed='true'] {
		background: var(--soft);
		border-color: var(--pine);
		box-shadow: inset 0 0 0 1px var(--pine);
	}
	.node-index {
		display: grid;
		place-items: center;
		background: var(--pine);
		color: #fffdf5;
		height: 1.75rem;
		min-width: 1.75rem;
		border-radius: 0.22rem;
		font-size: 0.75rem;
	}
	.node strong {
		display: block;
		line-height: 1.25;
	}
	small {
		display: block;
		color: var(--muted);
		margin-top: 0.17rem;
	}
	.transitions {
		list-style: none;
		margin: 0.3rem 0 0 0.75rem;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}
	.edge {
		font-size: 0.79rem;
		border-color: var(--line);
	}
	.edge[data-kind='decision'] {
		border-style: dashed;
	}
	.edge[data-kind='exception'] {
		border-color: #c69f90;
		color: var(--danger);
	}
	.edge[data-kind='hypothesis'] {
		border-style: dashed;
		background: var(--sand);
	}
	.arrow {
		font: 700 1rem/1 var(--mono);
	}
</style>
