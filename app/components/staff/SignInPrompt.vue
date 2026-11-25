<script lang="ts" setup>
	import { staffStrings } from '~/locales/staff';

	const { locale } = useAppLocale();

	const t = computed(() => staffStrings[locale.value]);

	const signInHref = computed(
		() => `/sign-in?next=${encodeURIComponent('/staff')}`,
	);
</script>

<template>
	<div>
		<h2 class="prompt-title">{{ t.signedOut.title }}</h2>
		<p class="prompt-lead">{{ t.signedOut.body }}</p>
		<NuxtLink
			:to="signInHref"
			class="button-primary"
		>
			{{ t.signedOut.link }}
		</NuxtLink>
	</div>
</template>

<style lang="scss" scoped>
	.prompt-title {
		font-size: 1.15rem;
	}

	.prompt-lead {
		color: var(--ink-soft);
	}
</style>
