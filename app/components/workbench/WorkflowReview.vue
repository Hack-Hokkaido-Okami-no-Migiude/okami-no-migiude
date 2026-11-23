<script setup lang="ts">
	import type { EvidenceRef, Session } from '#shared/p0/types';
	import {
		type EvidenceSource,
		type StepPatch,
		claimStateLabel,
	} from '../../composables/workbenchDescriptors';
	import EvidenceLinks from './EvidenceLinks.vue';
	import FindingDetail from './FindingDetail.vue';
	import WorkflowDiagram from './WorkflowDiagram.vue';
	import { currentDiagram } from '../../composables/workflowDiagrams';

	const props = defineProps<{
		session: Session;
		sources: EvidenceSource[];
		disabled: boolean;
		save: (
			id: string,
			patch: StepPatch,
			verify: boolean,
		) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const diagram = computed(() => currentDiagram(props.session.workflow));
	const reviewOnly = computed(() => {
		const visible = new Set(diagram.value.nodes.map(({ id }) => id));
		return props.session.workflow.steps.filter(
			({ id }) => !visible.has(id),
		);
	});
	const selectedId = ref('');
	const finding = ref<{ dirty: boolean } | null>(null);
	const step = computed(() =>
		props.session.workflow.steps.find(({ id }) => id === selectedId.value),
	);
	const edge = computed(() =>
		props.session.workflow.edges.find(({ id }) => id === selectedId.value),
	);
	const stepTitle = (id: string) =>
		props.session.workflow.steps.find((item) => item.id === id)?.label.value
		?? 'Unnamed finding';
	const selectedReviewOnly = computed(() =>
		reviewOnly.value.some(({ id }) => id === selectedId.value),
	);
	const edgeEvidence = computed(() => {
		if (!edge.value) {
			return [];
		}
		const references = [
			...edge.value.evidence,
			...edge.value.condition.evidence,
		];
		return references.filter(
			(reference, index) =>
				references.findIndex(
					(item) =>
						item.sourceId === reference.sourceId
						&& item.sourceRev === reference.sourceRev
						&& item.quote === reference.quote,
				) === index,
		);
	});

	function select(id: string) {
		if (
			selectedId.value === id
			|| (finding.value?.dirty
				&& !window.confirm('Discard unsaved edits to this finding?'))
		) {
			return;
		}
		selectedId.value = id;
	}

	watch(
		() => props.session.workflow,
		() => {
			if (step.value || edge.value) {
				return;
			}
			selectedId.value =
				diagram.value.nodes[0]?.id ?? reviewOnly.value[0]?.id ?? '';
		},
		{ immediate: true },
	);
</script>

<template>
	<section
		class="panel map-pane"
		aria-labelledby="current-workflow-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">02 / Evidence map</p>
				<h2 id="current-workflow-heading">Current workflow</h2>
			</div>
		</div>
		<p
			v-if="!session.discovery"
			class="quiet fine"
		>
			Run discovery to map interview claims and trace each supported
			handoff to its source.
		</p>
		<p
			v-else-if="session.discovery.stale"
			class="pill attention map-status"
		>
			Last saved map · refresh discovery
		</p>
		<WorkflowDiagram
			:diagram="diagram"
			label="Current workflow diagram"
			:selected-id="selectedId"
			:sources="sources"
			@select="select"
		/>
		<div
			v-if="reviewOnly.length"
			class="review-list"
		>
			<h3>Review-only findings</h3>
			<p class="fine quiet">These findings are not drawn as steps.</p>
			<div class="actions">
				<button
					v-for="findingStep in reviewOnly"
					:key="findingStep.id"
					class="button"
					type="button"
					:aria-pressed="selectedId === findingStep.id"
					@click="select(findingStep.id)"
				>
					{{ findingStep.label.value ?? 'Unnamed finding' }}
				</button>
			</div>
		</div>
		<div
			v-if="session.reviewNotices.length"
			class="review-list"
		>
			<h3>Review notices</h3>
			<ul>
				<li
					v-for="(notice, index) in session.reviewNotices"
					:key="`${notice.code}:${notice.targetId}:${index}`"
				>
					{{ notice.message }}
				</li>
			</ul>
		</div>
	</section>
	<section
		class="panel inspector"
		aria-labelledby="finding-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">03 / Consultant review</p>
				<h2 id="finding-heading">Finding details</h2>
			</div>
		</div>
		<div class="inspector-body">
			<FindingDetail
				v-if="step"
				:key="step.id"
				ref="finding"
				:step="step"
				:sources="sources"
				:review-only="selectedReviewOnly"
				:disabled="disabled"
				:save="save"
				@jump="emit('jump', $event)"
			/>
			<div v-else-if="edge">
				<p class="pill">{{ edge.kind }} transition</p>
				<h3>
					{{ stepTitle(edge.fromStepId) }} →
					{{ stepTitle(edge.toStepId) }}
				</h3>
				<p v-if="edge.condition.value">
					<strong>Condition:</strong> {{ edge.condition.value }} ·
					{{ claimStateLabel(edge.condition.state) }}
				</p>
				<p
					v-if="edge.condition.inference"
					class="fine quiet"
				>
					Inference: {{ edge.condition.inference }}
				</p>
				<EvidenceLinks
					:references="edgeEvidence"
					:sources="sources"
					@jump="emit('jump', $event)"
				/>
			</div>
			<p
				v-else
				class="empty"
			>
				Select a step or transition to inspect its claims and source
				quotes.
			</p>
		</div>
	</section>
</template>

<style scoped>
	.map-status {
		margin-bottom: 0.5rem;
	}
	.review-list {
		border-top: 1px solid var(--line);
		margin-top: 0.85rem;
	}
	.review-list h3 {
		margin: 0.65rem 0 0.33rem;
	}
	.review-list p {
		margin-top: 0;
	}
	.review-list ul {
		padding-left: 1.25rem;
		margin: 0.35rem 0;
	}
	.inspector-body {
		max-height: 37.5rem;
		overflow: auto;
		scrollbar-gutter: stable;
		padding: 0.15rem 0.3rem 0.15rem 0.18rem;
	}
	@media (max-width: 1070px) {
		.inspector-body {
			max-height: none;
		}
	}
</style>
