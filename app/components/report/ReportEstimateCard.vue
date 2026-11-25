<!-- One labeled estimate/assumption card (time savings, workload, costs). -->
<template>
	<section class="panel report-estimate h-100">
		<p class="eyebrow">
			{{ title }}
		</p>
		<ul class="report-estimate__items">
			<li
				v-for="(item, index) in items"
				:key="index"
			>
				{{ item }}
			</li>
		</ul>
		<p
			v-if="estimateLabel"
			class="report-estimate__label"
		>
			<span class="badge report-estimate__badge">
				{{ estimateLabel }}
			</span>
		</p>
	</section>
</template>

<script lang="ts" setup>
	defineProps<{
		title: string;
		items: string[];
		estimateLabel: string | null;
	}>();
</script>

<style lang="scss" scoped>
	.report-estimate {
		&__items {
			margin: 0 0 0.75rem;
			padding-left: 1.1rem;

			li + li {
				margin-top: 0.375rem;
			}
		}

		&__label {
			margin: 0;
		}

		&__badge {
			font-weight: 400;
			border: 1px dashed var(--bs-border-color);
		}
	}
</style>
