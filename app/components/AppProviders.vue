<template>
	<!-- No content -->
	<!-- Slot is only used to resolve hydration mismatch issues -->
	<slot></slot>
</template>

<script lang="ts" setup>
	// App identity. Kept as an injection so any component can resolve the
	// display name without importing the shell dictionary.
	provide('app-name', '女将の右腕');
</script>
