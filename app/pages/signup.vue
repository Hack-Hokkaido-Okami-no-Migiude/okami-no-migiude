<template>
	<div class="page-shell auth-page">
		<header class="auth-head">
			<p class="eyebrow">{{ t.signup.eyebrow }}</p>
			<h1 class="page-title">{{ t.signup.title }}</h1>
			<p class="page-lead">{{ t.signup.lead }}</p>
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
			<div class="form-field">
				<label for="signup-email">{{
					t.signup.fields.email.label
				}}</label>
				<input
					id="signup-email"
					v-model="form.email"
					type="email"
					name="email"
					required
					autocomplete="email"
				/>
			</div>
			<div class="form-field">
				<label for="signup-password">{{
					t.signup.fields.password.label
				}}</label>
				<input
					id="signup-password"
					v-model="form.password"
					type="password"
					name="password"
					required
					minlength="8"
					autocomplete="new-password"
					aria-describedby="signup-password-hint"
				/>
				<p
					id="signup-password-hint"
					class="form-field-hint"
				>
					{{ t.signup.fields.password.hint }}
				</p>
			</div>
			<div class="form-field">
				<label for="signup-name">{{
					t.signup.fields.name.label
				}}</label>
				<input
					id="signup-name"
					v-model="form.name"
					type="text"
					name="name"
					required
					autocomplete="name"
				/>
			</div>
			<div class="form-field">
				<label for="signup-business-name">
					{{ t.signup.fields.businessName.label }}
				</label>
				<input
					id="signup-business-name"
					v-model="form.businessName"
					type="text"
					name="businessName"
					required
					autocomplete="organization"
				/>
			</div>
			<div class="form-field">
				<label for="signup-business-type">
					{{ t.signup.fields.businessType.label }}
				</label>
				<select
					id="signup-business-type"
					v-model="form.businessType"
					name="businessType"
					required
				>
					<option
						value=""
						disabled
					>
						{{ t.signup.fields.businessType.placeholder }}
					</option>
					<option
						v-for="entry in businessTypeEntries"
						:key="entry.value"
						:value="entry.value"
					>
						{{ entry.label }}
					</option>
				</select>
			</div>
			<div
				v-show="form.businessType === 'other'"
				class="form-field"
			>
				<label for="signup-other-business-type">
					{{ t.signup.fields.otherBusinessType.label }}
					<em class="required-when">
						{{ t.signup.fields.otherBusinessType.requiredNote }}
					</em>
				</label>
				<input
					id="signup-other-business-type"
					v-model="form.otherBusinessType"
					type="text"
					name="otherBusinessType"
					:required="form.businessType === 'other'"
					:placeholder="t.signup.fields.otherBusinessType.placeholder"
				/>
			</div>
			<div class="form-field">
				<label for="signup-municipality">
					{{ t.signup.fields.municipality.label }}
				</label>
				<input
					id="signup-municipality"
					v-model="form.municipality"
					type="text"
					name="municipality"
					required
					:placeholder="t.signup.fields.municipality.hint"
				/>
			</div>
			<div class="form-field">
				<label for="signup-phone">
					{{ t.signup.fields.phone.label }}{{ t.signup.optionalMark }}
				</label>
				<input
					id="signup-phone"
					v-model="form.phone"
					type="tel"
					name="phone"
					autocomplete="tel"
				/>
			</div>
			<div class="form-field">
				<label for="signup-website">
					{{ t.signup.fields.website.label
					}}{{ t.signup.optionalMark }}
				</label>
				<input
					id="signup-website"
					v-model="form.website"
					type="url"
					name="website"
					autocomplete="url"
				/>
			</div>
			<div class="form-field">
				<label for="signup-note">
					{{ t.signup.fields.note.label }}{{ t.signup.optionalMark }}
				</label>
				<textarea
					id="signup-note"
					v-model="form.note"
					name="note"
					rows="3"
				></textarea>
			</div>
			<fieldset class="form-field locale-choice">
				<legend>{{ t.signup.fields.locale.label }}</legend>
				<label class="choice">
					<input
						v-model="form.locale"
						type="radio"
						name="locale"
						value="ja"
						required
					/>
					<span>{{ t.signup.fields.locale.ja }}</span>
				</label>
				<label class="choice">
					<input
						v-model="form.locale"
						type="radio"
						name="locale"
						value="en"
					/>
					<span>{{ t.signup.fields.locale.en }}</span>
				</label>
			</fieldset>
			<button
				type="submit"
				class="button-primary submit-button"
				:disabled="submitting"
			>
				{{ submitting ? t.signup.submitting : t.signup.submit }}
			</button>
		</form>
		<p class="auth-alt">
			<NuxtLink
				to="/sign-in"
				class="text-link"
				>{{ t.signup.signinLink }}</NuxtLink
			>
		</p>
	</div>
</template>

<script lang="ts" setup>
	import type { SessionResponse, SignupRequest } from '#shared/types/api';
	import type { BusinessType } from '#shared/types/domain';
	import { shellMessages } from '~/locales/shell';

	const { locale } = useAppLocale();
	const { refreshSession } = useOwnerSession();
	const route = useRoute();
	const t = computed(() => shellMessages[locale.value]);

	const form = reactive({
		email: '',
		password: '',
		name: '',
		businessName: '',
		businessType: '',
		otherBusinessType: '',
		municipality: '',
		phone: '',
		website: '',
		note: '',
		locale: locale.value,
	});

	const businessTypeEntries = computed(() =>
		(
			Object.entries(t.value.signup.businessTypes) as Array<
				[BusinessType, string]
			>
		).map(([value, label]) => ({ value, label })),
	);

	const submitting = ref(false);
	const errorCode = ref<string | null>(null);

	const errorMessage = computed(() => {
		switch (errorCode.value) {
			case 'email_taken':
				return t.value.signup.errors.email_taken;
			case 'validation':
				return t.value.signup.errors.validation;
			case 'network':
				return t.value.signup.errors.network;
			default:
				return null;
		}
	});

	async function onSubmit() {
		if (submitting.value) {
			return;
		}
		errorCode.value = null;
		if (
			form.businessType === 'other'
			&& form.otherBusinessType.trim() === ''
		) {
			errorCode.value = 'validation';
			document.getElementById('signup-other-business-type')?.focus();
			return;
		}
		submitting.value = true;
		try {
			const profile: SignupRequest['profile'] = {
				name: form.name.trim(),
				businessName: form.businessName.trim(),
				businessType: form.businessType as BusinessType,
				municipality: form.municipality.trim(),
				locale: form.locale,
			};
			if (form.businessType === 'other') {
				profile.otherBusinessType = form.otherBusinessType.trim();
			}
			const phone = form.phone.trim();
			if (phone !== '') {
				profile.phone = phone;
			}
			const website = form.website.trim();
			if (website !== '') {
				profile.website = website;
			}
			const note = form.note.trim();
			if (note !== '') {
				profile.note = note;
			}
			await $fetch<SessionResponse>('/api/auth/signup', {
				method: 'POST',
				body: {
					email: form.email.trim(),
					password: form.password,
					profile,
				},
			});
			// The server set the HttpOnly session cookie; mirror it locally, then
			// continue to the interview hub (or the ?next= target when present).
			await refreshSession();
			await navigateTo(
				safeInternalPath(route.query.next) ?? '/interview',
			);
		} catch (error) {
			const code = (error as { data?: { error?: string } })?.data?.error;
			errorCode.value =
				code === 'email_taken' || code === 'validation' ?
					code
				:	'network';
		} finally {
			submitting.value = false;
		}
	}

	useHead({ title: () => t.value.signup.title });
</script>
