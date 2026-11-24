// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: '2025-11-24',
	devtools: { enabled: true },
	modules: [
		'@nuxt/eslint',
		'@nuxt/fonts',
		'@nuxt/icon',
		'@nuxtjs/color-mode',
	],
	css: ['~/styles/global.scss'],
	nitro: {
		esbuild: {
			options: {
				target: 'esnext',
			},
		},
	},
	// https://fonts.nuxt.com/get-started/configuration
	fonts: {
		defaults: {
			weights: ['100 900'],
			styles: ['normal', 'italic'],
		},
		families: [
			{
				name: 'IBM Plex Serif',
				provider: 'google',
				weights: ['100 700'],
				display: 'swap',
			},
			{
				name: 'Material Symbols Outlined',
				provider: 'googleicons',
				fallbacks: [],
				weights: ['400'],
				variableAxis: {
					opsz: [{ min: 20, max: 48 }],
					FILL: [{ min: 0, max: 1 }],
					GRAD: [{ min: -50, max: 200 }],
				},
				display: 'block',
			},
		],
	},
	// https://color-mode.nuxtjs.org/usage/configuration
	colorMode: {
		preference: 'system',
		fallback: 'dark',
		dataValue: 'bs-theme',
	},
});
