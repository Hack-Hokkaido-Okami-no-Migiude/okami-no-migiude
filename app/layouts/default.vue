<template>
	<div class="app-frame">
		<a
			class="skip-link"
			href="#main"
			>{{ t.skipToContent }}</a
		>
		<header class="site-header">
			<div class="page-shell site-header-inner">
				<NuxtLink
					to="/"
					class="brand"
				>
					<img
						src="/branding/shima-enaga.svg"
						alt=""
						class="brand-mark"
						width="44"
						height="44"
					/>
					<span class="brand-name">{{ t.brand }}</span>
					<span class="brand-sub">{{ t.brandSub }}</span>
				</NuxtLink>
				<nav
					class="site-nav"
					:aria-label="t.localeSwitchLabel"
				>
					<div
						class="locale-switch"
						role="group"
						:aria-label="t.localeSwitchLabel"
					>
						<button
							type="button"
							class="locale-option"
							:class="{ 'is-active': locale === 'ja' }"
							:aria-pressed="locale === 'ja'"
							@click="locale = 'ja'"
						>
							日本語
						</button>
						<button
							type="button"
							class="locale-option"
							:class="{ 'is-active': locale === 'en' }"
							:aria-pressed="locale === 'en'"
							@click="locale = 'en'"
						>
							English
						</button>
					</div>
					<template v-if="user">
						<span class="session-name">{{
							user.profile.name
						}}</span>
						<NuxtLink
							v-if="user.role === 'owner'"
							to="/interview"
							class="button-secondary"
						>
							{{ t.nav.interview }}
						</NuxtLink>
						<NuxtLink
							v-if="user.role === 'owner'"
							to="/voice"
							class="button-secondary"
						>
							{{ t.nav.voice }}
						</NuxtLink>
						<NuxtLink
							v-else
							to="/staff"
							class="button-secondary"
						>
							{{ t.nav.staff }}
						</NuxtLink>
						<button
							type="button"
							class="button-secondary"
							@click="signOut"
						>
							{{ t.nav.signOut }}
						</button>
					</template>
					<template v-else>
						<NuxtLink
							to="/sign-in"
							class="button-secondary"
						>
							{{ t.nav.signIn }}
						</NuxtLink>
						<NuxtLink
							to="/signup"
							class="button-primary"
						>
							{{ t.nav.signup }}
						</NuxtLink>
					</template>
				</nav>
			</div>
		</header>
		<main
			id="main"
			class="site-main"
		>
			<slot></slot>
		</main>
		<footer class="site-footer">
			<div class="page-shell">
				<p class="footer-note">{{ t.footerNote }}</p>
				<p class="footer-demo">{{ t.footerDemo }}</p>
			</div>
		</footer>
	</div>
</template>

<script lang="ts" setup>
	import { shellMessages } from '~/locales/shell';

	const { locale } = useAppLocale();
	const { user, refreshSession, clearSession } = useOwnerSession();
	const t = computed(() => shellMessages[locale.value]);

	// One session lookup per request (SSR) / per load (client); the layout
	// wraps every page, so the chrome renders session-aware from the start.
	await callOnce('shell:owner-session-load', async () => {
		try {
			await refreshSession();
		} catch {
			// Session lookup failures render the signed-out chrome; the user can
			// still sign in or browse public pages.
		}
	});

	async function signOut() {
		try {
			await $fetch('/api/auth/logout', { method: 'POST' });
		} catch {
			// POST /api/auth/logout is idempotent; local state is cleared below
			// regardless so the chrome never shows a stale session.
		}
		clearSession();
		await navigateTo('/');
	}
</script>
