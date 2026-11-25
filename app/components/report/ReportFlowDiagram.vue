<!-- Side-by-side ordered flow diagrams: the current way of working next to
     the improved one (native, CSS-only; stacks on small screens). -->
<template>
	<section class="panel report-flow">
		<p class="eyebrow">
			{{ title }}
		</p>
		<p
			v-if="exampleLabel"
			class="report-flow__note"
		>
			{{ exampleLabel }}
		</p>
		<div class="report-flow__grid">
			<div class="report-flow__column report-flow__column--current">
				<p class="report-flow__column-title">
					<span
						class="material-symbols-outlined report-flow__icon"
						aria-hidden="true"
						>schedule</span
					>
					{{ currentLabel }}
				</p>
				<ol class="report-flow__steps">
					<li
						v-for="(step, index) in flow.currentSteps"
						:key="`current-${index}`"
						class="report-flow__step"
					>
						<span class="report-flow__badge">{{ index + 1 }}</span>
						<span class="report-flow__text">{{ step }}</span>
					</li>
				</ol>
			</div>
			<div
				class="report-flow__arrow d-none d-lg-flex"
				aria-hidden="true"
			>
				<span class="material-symbols-outlined">east</span>
			</div>
			<div class="report-flow__column report-flow__column--improved">
				<p class="report-flow__column-title">
					<span
						class="material-symbols-outlined report-flow__icon"
						aria-hidden="true"
						>bolt</span
					>
					{{ improvedLabel }}
				</p>
				<ol class="report-flow__steps">
					<li
						v-for="(step, index) in flow.improvedSteps"
						:key="`improved-${index}`"
						class="report-flow__step"
					>
						<span
							class="report-flow__badge report-flow__badge--improved"
						>
							{{ index + 1 }}
						</span>
						<span class="report-flow__text">{{ step }}</span>
					</li>
				</ol>
			</div>
		</div>
	</section>
</template>

<script lang="ts" setup>
	import type { ReportFlowPair } from '#shared/types/report-content';

	defineProps<{
		flow: ReportFlowPair;
		title: string;
		currentLabel: string;
		improvedLabel: string;
		exampleLabel: string | null;
	}>();
</script>

<style lang="scss" scoped>
	.report-flow {
		&__note {
			font-size: 0.85rem;
			opacity: 0.75;
			margin-bottom: 1rem;
		}

		&__grid {
			position: relative;
			display: grid;
			grid-template-columns: 1fr;
			gap: 1rem;

			@media (min-width: 992px) {
				grid-template-columns: 1fr 1fr;
				gap: 3rem;
			}
		}

		&__arrow {
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			width: 2.25rem;
			height: 2.25rem;
			border-radius: 50%;
			align-items: center;
			justify-content: center;
			z-index: 1;
		}

		&__column {
			border: 1px solid var(--bs-border-color);
			border-radius: 0.5rem;
			padding: 0.875rem;

			&--improved {
				border-color: var(--bs-success);
			}
		}

		&__column-title {
			display: flex;
			align-items: center;
			gap: 0.375rem;
			font-weight: 600;
			margin: 0 0 0.75rem;
		}

		&__icon {
			font-size: 1.125rem;
		}

		&__steps {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}

		&__step {
			display: flex;
			align-items: flex-start;
			gap: 0.5rem;
		}

		&__badge {
			flex: none;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.5rem;
			height: 1.5rem;
			border-radius: 50%;
			background: var(--bs-secondary-bg);
			font-size: 0.8rem;
			font-weight: 700;

			&--improved {
				background: var(--bs-success-bg-subtle);
				color: var(--bs-success-text-emphasis, var(--bs-success));
			}
		}

		&__text {
			min-width: 0;
		}
	}
</style>
