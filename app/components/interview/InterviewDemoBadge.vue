<template>
	<p class="badge text-bg-warning mb-0 interview-demo-badge">
		<span
			class="material-symbols-outlined"
			aria-hidden="true"
			>theater_comedy</span
		>
		<span>{{ label }}</span>
	</p>
</template>

<script lang="ts" setup>
	defineProps<{ label: string }>();
</script>

<style lang="scss" scoped>
	.interview-demo-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.75rem;

		.material-symbols-outlined {
			font-size: 1.1rem;
		}
	}
</style>
