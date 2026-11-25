<!-- Report page header: eyebrow, business name, status and meta chips. -->
<template>
	<header class="report-header">
		<p class="eyebrow">
			{{ copy.eyebrow }}
		</p>
		<h1 class="report-header__title">
			{{ heading }}
		</h1>
		<div class="report-header__chips">
			<span
				class="badge"
				:class="statusClass"
				>{{ statusLabel }}</span
			>
			<span
				v-if="draftLabel"
				class="badge report-header__draft"
			>
				{{ draftLabel }}
			</span>
			<span
				v-if="isStaff"
				class="badge report-header__staff"
			>
				{{ copy.viewingAsStaff }}
			</span>
			<span
				v-if="municipality"
				class="badge report-header__meta"
			>
				{{ copy.metaMunicipality }}: {{ municipality }}
			</span>
			<span
				v-if="generatedAtLabel"
				class="badge report-header__meta"
			>
				{{ copy.metaGeneratedAt }}: {{ generatedAtLabel }}
			</span>
		</div>
	</header>
</template>

<script lang="ts" setup>
	import { computed } from 'vue';
	import type { Report } from '#shared/types/domain';
	import type { ReportContent } from '#shared/types/report-content';
	import type { ReportPageCopy } from '~/locales/report';
	import { formatReportDateTime } from '~/utils/report-content';

	const props = defineProps<{
		report: Report;
		structured: ReportContent | null;
		copy: ReportPageCopy;
		isStaff: boolean;
	}>();

	const heading = computed(
		() => props.structured?.businessName || props.report.businessName,
	);

	const statusLabel = computed(
		() => props.copy.statusLabels[props.report.status],
	);

	const statusClass = computed(() => ({
		textBgSuccess: props.report.status === 'ready',
		textBgWarning: props.report.status === 'pending',
		textBgDanger: props.report.status === 'failed',
	}));

	const draftLabel = computed(() => props.structured?.draftLabel ?? null);

	const municipality = computed(
		() => props.structured?.meta.municipality ?? null,
	);

	const generatedAtLabel = computed(() => {
		const iso =
			props.structured?.meta.generatedAt ?? props.report.readyAt ?? null;
		return iso ? formatReportDateTime(iso, props.report.locale) : null;
	});
</script>

<style lang="scss" scoped>
	.report-header {
		margin-bottom: 1.5rem;

		&__title {
			font-size: 1.75rem;
			font-weight: 700;
			margin: 0.25rem 0 0.75rem;
		}

		&__chips {
			display: flex;
			flex-wrap: wrap;
			gap: 0.375rem;
		}

		&__draft {
			border: 1px solid var(--bs-warning);
		}

		&__staff {
			border: 1px solid var(--bs-info);
		}

		&__meta {
			font-weight: 400;
		}
	}
</style>
