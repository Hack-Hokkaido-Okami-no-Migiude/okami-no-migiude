<!-- One interview topic: observation and recommended action. -->
<template>
	<article class="panel report-topic">
		<h3 class="report-topic__title">
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

		&__line {
			margin: 0 0 0.375rem;

			.eyebrow {
				display: inline-block;
				margin-right: 0.5rem;
			}
		}
	}
</style>
