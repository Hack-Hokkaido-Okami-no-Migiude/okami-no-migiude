<template>
	<div
		class="interview-timer"
		:class="{ 'interview-timer--expired': expired }"
	>
		<p
			role="timer"
			class="interview-timer__display mb-0"
			:aria-label="`${strings.timer.label}: ${expired ? strings.timer.expired : remainingText}`"
		>
			<span class="interview-timer__label">{{
				strings.timer.label
			}}</span>
			<span
				v-if="!expired"
				class="interview-timer__value"
				>{{ remainingText }}</span
			>
			<span
				v-else
				class="interview-timer__value"
				>{{ strings.timer.expired }}</span
			>
		</p>
		<p
			class="visually-hidden"
			role="status"
		>
			{{ announcementText }}
		</p>
	</div>
</template>

<script lang="ts" setup>
	import type { DeadlineAnnouncementKey } from '../../utils/interview-deadline.ts';
	import type { InterviewStrings } from '../../locales/interview.ts';
	import { computed } from 'vue';

	const props = defineProps<{
		remainingText: string;
		expired: boolean;
		announcement: DeadlineAnnouncementKey | null;
		strings: InterviewStrings;
	}>();

	const announcementText = computed(() => {
		const key = props.announcement;
		if (key === null) {
			return '';
		}
		return props.strings.timer.announcements[key];
	});
</script>

<style lang="scss" scoped>
	.interview-timer__display {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.interview-timer__label {
		font-size: 0.875rem;
		opacity: 0.85;
	}

	.interview-timer__value {
		font-size: 1.75rem;
		font-weight: 700;
	}

	.interview-timer--expired .interview-timer__value {
		color: var(--bs-danger-text-emphasis, #b02a37);
	}
</style>
