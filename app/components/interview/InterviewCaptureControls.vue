<template>
	<section
		class="panel interview-capture"
		aria-labelledby="interview-capture-heading"
	>
		<h2 id="interview-capture-heading">
			{{ strings.capture.heading }}
		</h2>
		<p class="interview-capture__note">{{ strings.capture.note }}</p>

		<template v-if="capture.supported.value">
			<div class="d-flex align-items-center flex-wrap gap-2">
				<button
					v-if="!capture.recording.value"
					class="button-secondary"
					type="button"
					:disabled="disabled"
					@click="onStart"
				>
					<span
						class="material-symbols-outlined"
						aria-hidden="true"
						>mic</span
					>
					{{ strings.capture.startButton }}
				</button>
				<button
					v-else
					class="button-secondary interview-capture__stop"
					type="button"
					@click="onStop"
				>
					<span
						class="material-symbols-outlined"
						aria-hidden="true"
						>stop</span
					>
					{{ strings.capture.stopButton }}
				</button>
				<p
					v-if="capture.recording.value"
					class="interview-capture__recording mb-0"
				>
					<span
						class="material-symbols-outlined"
						aria-hidden="true"
						>radio_button_checked</span
					>
					{{ strings.capture.recordingBadge }}
				</p>
			</div>
			<p
				class="visually-hidden"
				role="status"
			>
				{{ statusText }}
			</p>
		</template>
		<p
			v-else
			class="notice interview-capture__help"
		>
			{{ strings.capture.unsupportedNote }}
		</p>

		<p
			v-if="capture.failure.value !== null"
			class="notice interview-capture__help"
		>
			{{ failureHelp }}
		</p>

		<div
			v-if="capture.reviewUrl.value !== null"
			class="interview-capture__review"
		>
			<p class="interview-capture__review-label">
				{{ strings.capture.reviewLabel }}
			</p>
			<audio
				:src="capture.reviewUrl.value"
				controls
				class="interview-capture__audio"
			></audio>
			<p class="interview-capture__review-hint">
				{{ strings.capture.reviewHint }}
			</p>
			<button
				class="button-secondary"
				type="button"
				@click="onDiscard"
			>
				{{ strings.capture.clearReview }}
			</button>
		</div>
	</section>
</template>

<script lang="ts" setup>
	import type {
		CaptureController,
		CaptureFailure,
	} from '../../composables/useInterviewCapture.ts';
	import { computed, ref, watch } from 'vue';
	import type { InterviewStrings } from '../../locales/interview.ts';

	const props = defineProps<{
		capture: CaptureController;
		strings: InterviewStrings;
		deadlineMs: number | null;
		disabled: boolean;
	}>();

	const statusText = ref('');

	watch(
		() => props.capture.phase.value,
		(phase, previous) => {
			if (phase === 'requesting') {
				statusText.value = props.strings.capture.requestingAnnouncement;
				return;
			}
			if (phase === 'recording') {
				statusText.value = props.strings.capture.startedAnnouncement;
				return;
			}
			if (phase === 'idle' && previous === 'recording') {
				statusText.value = props.strings.capture.stoppedAnnouncement;
				return;
			}
		},
	);

	const FAILURE_HELP: Record<
		Exclude<CaptureFailure, null>,
		keyof InterviewStrings['capture']
	> = {
		denied: 'deniedHelp',
		not_found: 'notFoundHelp',
		insecure: 'unknownHelp',
		unknown: 'unknownHelp',
	};

	const failureHelp = computed(() => {
		const failure = props.capture.failure.value;
		if (failure === null) {
			return '';
		}
		const key = FAILURE_HELP[failure];
		return props.strings.capture[key];
	});

	async function onStart() {
		await props.capture.start(props.deadlineMs);
	}

	function onStop() {
		props.capture.stop('user');
	}

	function onDiscard() {
		props.capture.clearReview();
	}
</script>

<style lang="scss" scoped>
	.interview-capture__note {
		font-size: 0.9rem;
		opacity: 0.9;
	}

	.interview-capture__recording {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-weight: 600;
		color: var(--bs-danger-text-emphasis, #b02a37);

		.material-symbols-outlined {
			font-size: 1rem;
		}
	}

	.interview-capture__help {
		margin-top: 0.75rem;
		margin-bottom: 0;
	}

	.interview-capture__review {
		margin-top: 1rem;
		border: 1px dashed var(--bs-border-color);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
	}

	.interview-capture__review-label {
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.interview-capture__audio {
		width: 100%;
		max-width: 30rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.interview-capture__review-hint {
		font-size: 0.85rem;
		opacity: 0.85;
	}
</style>
