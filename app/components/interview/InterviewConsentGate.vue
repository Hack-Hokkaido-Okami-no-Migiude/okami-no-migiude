<template>
	<section
		class="panel interview-consent"
		aria-labelledby="interview-consent-heading"
	>
		<h2
			id="interview-consent-heading"
			tabindex="-1"
		>
			{{ strings.consent.heading }}
		</h2>
		<p>{{ strings.consent.intro }}</p>
		<fieldset class="interview-consent__fieldset">
			<legend>{{ strings.consent.legend }}</legend>
			<div
				v-for="item in items"
				:key="item.key"
				class="form-check interview-consent__item"
			>
				<input
					:id="`interview-consent-${item.key}`"
					v-model="checked[item.key]"
					class="form-check-input"
					type="checkbox"
					name="interview-consent"
					@change="emitChange"
				/>
				<label
					class="form-check-label"
					:for="`interview-consent-${item.key}`"
				>
					<strong>{{ item.label }}</strong>
					<span class="d-block interview-consent__detail">
						{{ item.detail }}
					</span>
				</label>
			</div>
		</fieldset>
		<p
			v-if="!allChecked"
			class="interview-consent__hint"
		>
			{{ strings.consent.requiredHint }}
		</p>
		<button
			class="button-primary"
			type="button"
			:disabled="!allChecked || starting"
			@click="emit('confirm')"
		>
			{{
				starting ?
					strings.consent.starting
				:	strings.consent.startButton
			}}
		</button>
	</section>
</template>

<script lang="ts" setup>
	import type { ConsentsState } from '../../utils/interview-consent.ts';
	import type { InterviewStrings } from '../../locales/interview.ts';
	import { computed, reactive } from 'vue';

	const props = defineProps<{
		strings: InterviewStrings;
		starting: boolean;
	}>();

	const emit = defineEmits<{
		change: [state: ConsentsState];
		confirm: [];
	}>();

	const checked = reactive({
		processing: false,
		privacy: false,
		staff: false,
	});

	const items = computed(() => [
		{
			key: 'processing' as const,
			label: props.strings.consent.items.processing.label,
			detail: props.strings.consent.items.processing.detail,
		},
		{
			key: 'privacy' as const,
			label: props.strings.consent.items.privacy.label,
			detail: props.strings.consent.items.privacy.detail,
		},
		{
			key: 'staff' as const,
			label: props.strings.consent.items.staff.label,
			detail: props.strings.consent.items.staff.detail,
		},
	]);

	const allChecked = computed(
		() => checked.processing && checked.privacy && checked.staff,
	);

	function emitChange() {
		const state: ConsentsState = {
			processing: checked.processing,
			privacy: checked.privacy,
			staff: checked.staff,
		};
		emit('change', state);
	}
</script>

<style lang="scss" scoped>
	.interview-consent__fieldset {
		border: 1px solid var(--bs-border-color);
		border-radius: 0.5rem;
		padding: 1rem;
		margin: 0 0 1rem;

		legend {
			font-size: 0.95rem;
			font-weight: 600;
			padding: 0 0.5rem;
			float: none;
			width: auto;
		}
	}

	.interview-consent__item {
		margin-bottom: 1rem;

		.interview-consent__detail {
			font-size: 0.9rem;
			opacity: 0.9;
			margin-top: 0.25rem;
		}
	}

	.interview-consent__hint {
		font-size: 0.9rem;
		opacity: 0.85;
	}
</style>
