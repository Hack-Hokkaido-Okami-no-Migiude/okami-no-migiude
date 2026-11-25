<script lang="ts" setup>
	import type { ReportStatus } from '#shared/types/domain';
	import { staffStrings } from '~/locales/staff';

	const props = defineProps<{ status: ReportStatus }>();

	const { locale } = useAppLocale();

	const label = computed(
		() => staffStrings[locale.value].status[props.status],
	);
</script>

<template>
	<span
		class="status-pill"
		:class="`is-${props.status}`"
		>{{ label }}</span
	>
</template>

<style lang="scss" scoped>
	.status-pill {
		display: inline-block;
		border-radius: 999px;
		border: 1px solid transparent;
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.is-ready {
		background: rgba(47, 93, 67, 0.14);
		border-color: rgba(47, 93, 67, 0.4);
		color: var(--evergreen-deep);
	}

	.is-pending {
		background: rgba(36, 56, 44, 0.07);
		border-color: var(--line-strong);
		color: var(--ink-soft);
	}

	.is-failed {
		background: rgba(176, 74, 33, 0.12);
		border-color: rgba(176, 74, 33, 0.4);
		color: var(--rust-deep);
	}
</style>
