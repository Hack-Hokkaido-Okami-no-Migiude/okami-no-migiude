<template>
	<section
		class="panel interview-transcript"
		aria-labelledby="interview-transcript-heading"
	>
		<h2
			id="interview-transcript-heading"
			tabindex="-1"
		>
			{{ strings.transcript.heading }}
		</h2>
		<p
			v-if="restored && !readonly"
			class="notice interview-transcript__restored"
		>
			{{ strings.transcript.restored }}
		</p>
		<div class="form-field">
			<label for="interview-transcript-input">{{
				strings.transcript.label
			}}</label>
			<p
				id="interview-transcript-hint"
				class="interview-transcript__hint"
			>
				{{
					readonly ?
						strings.transcript.submitHint
					:	strings.transcript.hint
				}}
			</p>
			<textarea
				id="interview-transcript-input"
				class="form-control interview-transcript__textarea"
				:value="modelValue"
				rows="14"
				:maxlength="maxChars"
				:readonly="readonly"
				:aria-invalid="invalid"
				:aria-describedby="describedBy"
				@input="onInput"
			></textarea>
			<p
				id="interview-transcript-count"
				class="interview-transcript__count"
			>
				{{ countText }}
			</p>
			<p
				v-if="validationMessage !== null"
				id="interview-transcript-error"
				class="interview-transcript__error"
			>
				{{ validationMessage }}
			</p>
		</div>
	</section>
</template>

<script lang="ts" setup>
	import {
		TRANSCRIPT_MAX_CHARS,
		checkTranscript,
		fillTemplate,
	} from '../../utils/interview-transcript.ts';
	import type { InterviewStrings } from '../../locales/interview.ts';
	import { computed } from 'vue';

	const props = defineProps<{
		modelValue: string;
		strings: InterviewStrings;
		restored: boolean;
		readonly: boolean;
		showValidation: boolean;
	}>();

	const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

	const maxChars = TRANSCRIPT_MAX_CHARS;

	const countText = computed(() =>
		fillTemplate(props.strings.transcript.charCount, {
			count: props.modelValue.length,
		}),
	);

	const check = computed(() => checkTranscript(props.modelValue));

	const invalid = computed(() => props.showValidation && !check.value.ok);

	const validationMessage = computed(() => {
		if (!invalid.value) {
			return null;
		}
		return (
			check.value.ok ? null
			: check.value.reason === 'empty' ?
				props.strings.transcript.emptyError
			:	props.strings.transcript.tooLongError
		);
	});

	const describedBy = computed(() => {
		const ids = ['interview-transcript-hint', 'interview-transcript-count'];
		if (validationMessage.value !== null) {
			ids.push('interview-transcript-error');
		}
		return ids.join(' ');
	});

	function onInput(event: Event) {
		const target = event.target;
		if (target instanceof HTMLTextAreaElement) {
			emit('update:modelValue', target.value);
		}
	}
</script>

<style lang="scss" scoped>
	.interview-transcript__restored {
		margin-bottom: 0.75rem;
	}

	.interview-transcript__hint {
		font-size: 0.85rem;
		opacity: 0.85;
		margin-bottom: 0.5rem;
	}

	.interview-transcript__textarea {
		min-height: 14rem;
		font-family: var(--bs-font-monospace, monospace);
		font-size: 0.95rem;
	}

	.interview-transcript__count {
		font-size: 0.85rem;
		opacity: 0.85;
		font-variant-numeric: tabular-nums;
		margin-top: 0.25rem;
		margin-bottom: 0;
	}

	.interview-transcript__error {
		color: var(--bs-danger-text-emphasis, #b02a37);
		font-size: 0.9rem;
		margin-top: 0.25rem;
		margin-bottom: 0;
	}
</style>
