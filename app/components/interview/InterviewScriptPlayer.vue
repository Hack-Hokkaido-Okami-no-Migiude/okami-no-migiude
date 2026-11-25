<template>
	<section
		class="panel interview-script"
		aria-labelledby="interview-script-heading"
	>
		<div
			class="d-flex align-items-center justify-content-between flex-wrap gap-2"
		>
			<h2
				id="interview-script-heading"
				class="mb-0"
			>
				{{ strings.script.heading }}
			</h2>
			<InterviewDemoBadge :label="script.fictionalLabel" />
		</div>
		<p class="interview-script__note">{{ strings.script.note }}</p>
		<p class="interview-script__persona">
			{{ strings.script.personaLabel }}:
			<strong :lang="locale">{{ script.personaName }}</strong>
		</p>

		<div
			:lang="locale"
			class="interview-script__line"
			aria-labelledby="interview-script-current-label"
		>
			<p
				id="interview-script-current-label"
				class="visually-hidden"
			>
				{{ strings.script.lineLabel }}
			</p>
			<template v-if="currentLine !== null">
				<p class="interview-script__speaker">
					{{
						currentLine.speaker === 'interviewer' ?
							script.speakerLabels.interviewer
						:	script.speakerLabels.owner
					}}
				</p>
				<p class="interview-script__text">{{ currentLine.text }}</p>
			</template>
			<p
				v-else
				class="interview-script__text interview-script__text--done"
			>
				{{ strings.script.done }}
			</p>
		</div>
		<p
			class="visually-hidden"
			role="status"
		>
			{{ revealedAnnouncement }}
		</p>

		<div class="d-flex align-items-center flex-wrap gap-2">
			<p class="interview-script__progress mb-0">
				{{ progressText }}
			</p>
			<button
				class="button-primary"
				type="button"
				:disabled="currentLine === null"
				@click="revealNext"
			>
				{{ strings.script.nextLine }}
			</button>
			<button
				class="button-secondary"
				type="button"
				:disabled="currentLine === null"
				@click="revealAll"
			>
				{{ strings.script.fillAll }}
			</button>
			<button
				class="button-secondary"
				type="button"
				@click="restart"
			>
				{{ strings.script.restart }}
			</button>
		</div>

		<div
			v-if="speech.supported.value"
			class="form-check interview-script__speech"
		>
			<input
				id="interview-script-speech"
				v-model="speechOn"
				class="form-check-input"
				type="checkbox"
				@change="onSpeechToggle"
			/>
			<label
				class="form-check-label"
				for="interview-script-speech"
			>
				{{ strings.script.speechLabel }}
			</label>
		</div>
		<p
			v-else
			class="interview-script__speech-unsupported"
		>
			{{ strings.script.speechUnsupported }}
		</p>
	</section>
</template>

<script lang="ts" setup>
	import { computed, ref } from 'vue';
	import {
		fillTemplate,
		renderScriptTranscript,
	} from '../../utils/interview-transcript.ts';
	import type { InterviewScriptData } from '../../locales/interview-script.ts';
	import type { InterviewStrings } from '../../locales/interview.ts';
	import type { Locale } from '../../../shared/types/domain.ts';
	import type { SpeechController } from '../../composables/useInterviewSpeech.ts';

	const props = defineProps<{
		strings: InterviewStrings;
		script: InterviewScriptData;
		locale: Locale;
		speech: SpeechController;
		/** Number of script lines already present in the transcript. */
		initialIndex: number;
	}>();

	const emit = defineEmits<{
		append: [text: string];
		appendAll: [text: string];
		reset: [];
	}>();

	const index = ref(
		Math.max(0, Math.min(props.initialIndex, props.script.lines.length)),
	);
	const speechOn = ref(false);

	const currentLine = computed(() => {
		if (index.value >= props.script.lines.length) {
			return null;
		}
		return props.script.lines[index.value] ?? null;
	});

	const progressText = computed(() =>
		fillTemplate(props.strings.script.progress, {
			current: Math.min(index.value, props.script.lines.length),
			total: props.script.lines.length,
		}),
	);

	const revealedAnnouncement = computed(() => {
		const line = currentLine.value;
		if (line === null) {
			return '';
		}
		const speaker =
			line.speaker === 'interviewer' ?
				props.script.speakerLabels.interviewer
			:	props.script.speakerLabels.owner;
		return `${speaker} — ${props.strings.script.lineLabel}`;
	});

	function speakIfEnabled() {
		if (!speechOn.value) {
			return;
		}
		const line = currentLine.value;
		if (line !== null && line.speaker === 'interviewer') {
			props.speech.speak(line.text, props.locale);
		}
	}

	function revealNext() {
		const line = currentLine.value;
		if (line === null) {
			return;
		}
		emit(
			'append',
			renderScriptTranscript([line], props.script.speakerLabels),
		);
		index.value += 1;
		speakIfEnabled();
	}

	function revealAll() {
		const remaining = props.script.lines.slice(index.value);
		if (remaining.length === 0) {
			return;
		}
		emit(
			'appendAll',
			renderScriptTranscript(remaining, props.script.speakerLabels),
		);
		index.value = props.script.lines.length;
		props.speech.cancel();
	}

	function restart() {
		props.speech.cancel();
		index.value = 0;
		emit('reset');
	}

	function onSpeechToggle() {
		props.speech.cancel();
		speakIfEnabled();
	}
</script>

<style lang="scss" scoped>
	.interview-script__note {
		font-size: 0.9rem;
		opacity: 0.9;
	}

	.interview-script__line {
		border: 1px dashed var(--bs-border-color);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		min-height: 4.5rem;
	}

	.interview-script__speaker {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.interview-script__text {
		margin-bottom: 0;
	}

	.interview-script__text--done {
		opacity: 0.75;
	}

	.interview-script__progress {
		font-variant-numeric: tabular-nums;
		font-size: 0.9rem;
	}

	.interview-script__speech {
		margin-top: 0.75rem;
	}

	.interview-script__speech-unsupported {
		font-size: 0.85rem;
		opacity: 0.8;
		margin-top: 0.75rem;
		margin-bottom: 0;
	}
</style>
