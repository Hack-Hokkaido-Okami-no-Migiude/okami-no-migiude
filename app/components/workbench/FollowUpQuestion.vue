<script setup lang="ts">
	import type { EvidenceRef, Question } from '#shared/p0/types';
	import EvidenceLinks from './EvidenceLinks.vue';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';
	import { registerWorkbenchDraft } from '../../composables/useDraftProtection';

	const props = defineProps<{
		question: Question;
		target: string | undefined;
		sources: EvidenceSource[];
		disabled: boolean;
		save: (id: string, text: string) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const editing = ref(false);
	const text = ref('');
	const startValue = ref('');
	const input = ref<HTMLTextAreaElement | null>(null);
	const dirty = computed(
		() => editing.value && text.value !== startValue.value,
	);
	registerWorkbenchDraft(dirty);
	const evidence = computed(() => {
		const answer = props.question.answer;
		return answer ?
				[
					{
						sourceId: answer.id,
						sourceRev: answer.sourceRev,
						quote: answer.text,
					},
				]
			:	[];
	});

	async function start() {
		startValue.value = props.question.answer?.text ?? '';
		text.value = startValue.value;
		editing.value = true;
		await nextTick();
		input.value?.focus();
	}

	async function submit() {
		if (
			text.value.trim()
			&& (await props.save(props.question.id, text.value))
		) {
			editing.value = false;
		}
	}
</script>

<template>
	<article class="question">
		<div class="actions">
			<span
				class="pill"
				:class="{
					attention:
						question.priority === 'high'
						&& question.status === 'open',
				}"
				>{{
					question.status === 'open' ?
						`${question.priority} priority`
					:	question.status
				}}</span><span class="quiet fine"
				>{{ question.factKey
				}}<template v-if="target"> · {{ target }}</template></span
			>
		</div>
		<h3>{{ question.prompt }}</h3>
		<p class="quiet">{{ question.whyItMatters }}</p>
		<EvidenceLinks
			:references="evidence"
			:sources="sources"
			@jump="emit('jump', $event)"
		/>
		<form
			v-if="editing"
			class="stack answer-form"
			@submit.prevent="submit"
		>
			<label
				>Consultant answer
				<textarea
					ref="input"
					v-model="text"
					dir="auto"
					rows="3"
					required
				/>
			</label>
			<p
				v-if="startValue !== (question.answer?.text ?? '')"
				class="pill attention"
			>
				The saved answer changed. Review it above before saving over it.
			</p>
			<p class="fine quiet">
				Saving records a separate source; it does not call a provider.
				Rerun discovery to use the answer.
			</p>
			<div class="actions">
				<button
					class="button primary"
					type="submit"
					:disabled="disabled || !text.trim()"
				>
					Save answer
				</button>
				<button
					class="button"
					type="button"
					@click="editing = false"
				>
					Cancel
				</button>
			</div>
		</form>
		<button
			v-else-if="question.status === 'open' || question.answer"
			class="button answer-form"
			type="button"
			@click="start"
		>
			{{ question.answer ? 'Edit answer' : 'Record answer' }}
		</button>
	</article>
</template>

<style scoped>
	.question {
		border-top: 1px solid var(--line);
		padding: 0.8rem 0;
	}
	.question h3 {
		margin: 0.45rem 0 0.3rem;
	}
	.question p {
		margin: 0;
	}
	.answer-form {
		margin-top: 0.65rem;
	}
</style>
