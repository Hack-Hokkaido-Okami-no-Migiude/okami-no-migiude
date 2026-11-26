<template>
	<div class="home">
		<section class="hero">
			<div class="page-shell hero-inner">
				<div class="hero-copy">
					<p class="eyebrow">{{ t.home.eyebrow }}</p>
					<h1 class="hero-title">{{ t.home.title }}</h1>
					<p class="hero-lead">{{ t.home.lead }}</p>
					<div
						v-if="!user"
						class="hero-actions"
					>
						<NuxtLink
							to="/signup"
							class="button-primary"
						>
							{{ t.home.ctaSignup }}
						</NuxtLink>
						<NuxtLink
							to="/sign-in"
							class="button-secondary"
						>
							{{ t.home.ctaSignIn }}
						</NuxtLink>
					</div>
				</div>
				<picture class="hero-art">
					<source
						media="(prefers-reduced-motion: no-preference)"
						type="image/webp"
						srcset="/branding/shima-enaga-idle.webp"
					/>
					<source
						type="image/webp"
						srcset="/branding/shima-enaga-rest.webp"
					/>
					<img
						src="/branding/shima-enaga.svg"
						:alt="t.home.mascotAlt"
						class="hero-mascot"
						width="280"
						height="280"
					/>
				</picture>
			</div>
		</section>
		<section class="page-shell home-start">
			<div class="panel start-panel">
				<p class="eyebrow">{{ t.home.startOwnerTitle }}</p>
				<template v-if="user?.role === 'owner'">
					<NuxtLink
						to="/interview"
						class="button-primary"
					>
						{{ t.home.ctaStartOwner }}
					</NuxtLink>
				</template>
				<template v-else-if="user?.role === 'staff'">
					<NuxtLink
						to="/staff"
						class="button-secondary"
					>
						{{ t.nav.staff }}
					</NuxtLink>
				</template>
				<template v-else>
					<NuxtLink
						:to="{
							path: '/sign-in',
							query: { next: '/interview' },
						}"
						class="button-primary"
					>
						{{ t.home.ctaStartOwner }}
					</NuxtLink>
					<p class="start-hint">{{ t.home.ctaStartOwnerHint }}</p>
				</template>
			</div>
		</section>
		<section class="page-shell home-steps">
			<h2 class="section-title">{{ t.home.stepsTitle }}</h2>
			<ol class="steps-grid">
				<li
					v-for="(step, index) in t.home.steps"
					:key="index"
					class="panel step"
				>
					<p class="step-number">{{ index + 1 }}</p>
					<h3 class="step-title">{{ step.title }}</h3>
					<p class="step-body">{{ step.body }}</p>
				</li>
			</ol>
		</section>
	</div>
</template>

<script lang="ts" setup>
	import { shellMessages } from '~/locales/shell';

	const { locale } = useAppLocale();
	const { user } = useOwnerSession();
	const t = computed(() => shellMessages[locale.value]);

	useHead({
		title: () =>
			locale.value === 'ja' ?
				'中小事業者の経営相談ポータル'
			:	'Owner portal',
	});
</script>
