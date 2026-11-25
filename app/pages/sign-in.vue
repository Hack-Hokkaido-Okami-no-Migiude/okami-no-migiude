<template>
	<div class="page-shell auth-page">
		<header class="auth-head">
			<p class="eyebrow">{{ t.signin.eyebrow }}</p>
			<h1 class="page-title">{{ t.signin.title }}</h1>
			<p class="page-lead">{{ t.signin.lead }}</p>
		</header>
		<p
			v-if="errorMessage"
			class="notice notice--warn"
			role="alert"
		>
			{{ errorMessage }}
		</p>
		<form
			class="panel auth-form"
			@submit.prevent="onSubmit"
		>
			<!-- Only an internal-safe ?next= value is ever echoed back. -->
			<input
				type="hidden"
				name="next"
				:value="nextPath ?? ''"
			/>
			<div class="form-field">
				<label for="signin-email">{{
					t.signin.fields.email.label
				}}</label>
				<input
					id="signin-email"
					v-model="form.email"
					type="email"
					name="email"
					required
					autocomplete="email"
				/>
			</div>
			<div class="form-field">
				<label for="signin-password">{{
					t.signin.fields.password.label
				}}</label>
				<input
					id="signin-password"
					v-model="form.password"
					type="password"
					name="password"
					required
					autocomplete="current-password"
				/>
			</div>
			<button
				type="submit"
				class="button-primary submit-button"
				:disabled="submitting"
			>
				{{ submitting ? t.signin.submitting : t.signin.submit }}
			</button>
		</form>
		<p class="auth-alt">
			<NuxtLink
				to="/signup"
				class="text-link"
				>{{ t.signin.signupLink }}</NuxtLink
			>
		</p>
	</div>
</template>

<script lang="ts" setup>
	import type { SessionResponse } from '#shared/types/api';
	import { shellMessages } from '~/locales/shell';

	const { locale } = useAppLocale();
	const { refreshSession } = useOwnerSession();
	const route = useRoute();
	const t = computed(() => shellMessages[locale.value]);

	// /sign-in?next=/reports/:id returns to internal-safe routes after the
	// session is established; anything else is dropped.
	const nextPath = computed(() =>
		safeInternalPath(
			typeof route.query.next === 'string' ? route.query.next : undefined,
		),
	);

	const form = reactive({
		email: '',
		password: '',
	});

	const submitting = ref(false);
	const errorCode = ref<string | null>(null);

	const errorMessage = computed(() => {
		switch (errorCode.value) {
			case 'invalid_credentials':
				return t.value.signin.errors.invalid_credentials;
			case 'network':
				return t.value.signin.errors.network;
			default:
				return null;
		}
	});

	async function onSubmit() {
		if (submitting.value) {
			return;
		}
		errorCode.value = null;
		submitting.value = true;
		try {
			await $fetch<SessionResponse>('/api/auth/login', {
				method: 'POST',
				body: {
					email: form.email.trim(),
					password: form.password,
				},
			});
			await refreshSession();
			await navigateTo(nextPath.value ?? '/');
		} catch (error) {
			const code = (error as { data?: { error?: string } })?.data?.error;
			errorCode.value = code === 'invalid_credentials' ? code : 'network';
		} finally {
			submitting.value = false;
		}
	}

	useHead({ title: () => t.value.signin.title });
</script>
