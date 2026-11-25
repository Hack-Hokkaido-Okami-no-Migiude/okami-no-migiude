<!-- One interview topic: rank, observation and recommended action. -->
<template>
	<article class="panel report-topic">
		<h3 class="report-topic__title">
			<span
				v-if="topic.rank !== null"
				class="report-topic__rank"
			>
				{{ rankLabel }} {{ topic.rank }}
			</span>
			{{ topic.title }}
		</h3>
		<p
			v-if="topic.observation"
			class="report-topic__line"
		>
			<span class="eyebrow">{{ observationLabel }}</span>
			{{ topic.observation }}
		</p>
		<p
			v-if="topic.action"
			class="report-topic__line"
		>
			<span class="eyebrow">{{ actionLabel }}</span>
			{{ topic.action }}
		</p>
	</article>
</template>

<script lang="ts" setup>
	import type { ReportTopicContent } from '#shared/types/report-content';

	defineProps<{
		topic: ReportTopicContent;
		/** Locale label for the rank badge, e.g. 優先度 / Priority. */
		rankLabel: string;
		observationLabel: string;
		actionLabel: string;
	}>();
</script>

<style lang="scss" scoped>
	.report-topic {
		&__title {
			font-size: 1.05rem;
			font-weight: 600;
			margin: 0 0 0.5rem;
		}

		&__rank {
			display: inline-block;
			margin-right: 0.5rem;
			padding: 0.05rem 0.5rem;
			border-radius: 999px;
			background: var(--bs-secondary-bg, #e9ecef);
			font-size: 0.8rem;
			font-weight: 600;
			vertical-align: middle;
		}

		&__line {
			margin: 0 0 0.375rem;

			.eyebrow {
				display: inline-block;
				margin-right: 0.5rem;
			}
		}
	}
</style>
