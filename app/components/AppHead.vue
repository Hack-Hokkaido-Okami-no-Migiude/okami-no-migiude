<template>
	<!-- No content -->
	<!-- Slot is only used to resolve hydration mismatch issues -->
	<slot></slot>
</template>

<script lang="ts" setup>
	import { shellMessages } from '~/locales/shell';

	const { locale } = useAppLocale();
	const messages = computed(() => shellMessages[locale.value]);

	useHead({
		// Document language follows the presentation locale (ja default).
		htmlAttrs: { lang: () => locale.value },
		titleTemplate: (title) =>
			title ?
				`${title} · ${messages.value.brand}`
			:	`${messages.value.brand} · ${messages.value.brandSub}`,
		meta: [
			{
				name: 'description',
				content: () => messages.value.metaDescription,
			},
		],
		link: [
			{
				rel: 'icon',
				type: 'image/svg+xml',
				href: '/branding/favicon.svg',
			},
		],
	});
</script>
