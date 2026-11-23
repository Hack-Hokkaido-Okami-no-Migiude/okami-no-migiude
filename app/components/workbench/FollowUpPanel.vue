<script setup lang="ts">
	import type { EvidenceRef, Question, Step } from '#shared/p0/types';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';
	import FollowUpQuestion from './FollowUpQuestion.vue';

	const props = defineProps<{
		questions: Question[];
		steps: Step[];
		sources: EvidenceSource[];
		disabled: boolean;
		analyzed: boolean;
		save: (id: string, text: string) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const weights = { high: 0, medium: 1, low: 2 } satisfies Record<
		Question['priority'],
		number
	>;
	const ordered = computed(() =>
		props.questions.toSorted(
			(left, right) =>
				weights[left.priority] - weights[right.priority]
				|| (left.id < right.id ? -1 : Number(left.id > right.id)),
		),
	);
	const open = computed(() =>
		ordered.value.filter((question) => question.status === 'open'),
	);
	const history = computed(() =>
		ordered.value.filter((question) => question.status !== 'open'),
	);
	const questionsByStatus = computed(() => [...open.value, ...history.value]);
	const showHistory = ref(false);
	const titleFor = (question: Question) =>
		props.steps.find((step) => step.id === question.targetStepId)?.label
			.value ?? undefined;
</script>

<template>
	<section
		class="panel follow-up"
		aria-labelledby="follow-up-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">Interview review</p>
				<h2 id="follow-up-heading">Open questions</h2>
			</div>
			<span class="pill">{{ open.length }} open</span>
		</div>
		<p
			v-if="!open.length"
			class="empty"
		>
			{{
				analyzed ? 'No open questions.' : (
					'Run discovery to identify unanswered questions.'
				)
			}}
		</p>
		<template
			v-for="question in questionsByStatus"
			:key="question.id"
		>
			<div
				v-if="question.id === history[0]?.id"
				class="history"
			>
				<button
					class="button"
					type="button"
					:aria-expanded="showHistory"
					@click="showHistory = !showHistory"
				>
					Question history ({{ history.length }})
				</button>
			</div>
			<FollowUpQuestion
				v-show="question.status === 'open' || showHistory"
				:question="question"
				:sources="sources"
				:target="titleFor(question)"
				:disabled="disabled"
				:save="save"
				@jump="emit('jump', $event)"
			/>
		</template>
	</section>
</template>

<style scoped>
	.history {
		border-top: 1px solid var(--line);
		padding-top: 0.75rem;
	}
	.history button {
		margin-bottom: 0.6rem;
	}
</style>
