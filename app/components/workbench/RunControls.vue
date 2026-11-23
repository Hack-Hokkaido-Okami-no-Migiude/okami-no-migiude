<script setup lang="ts">
	import type { RunMode } from '#shared/p0/api';

	const props = defineProps<{
		operation: 'discovery' | 'proposal';
		disabled: boolean;
		fixtureAvailable: boolean;
		repeat: boolean;
	}>();
	const emit = defineEmits<{
		run: [mode: RunMode, allowExternal: boolean];
	}>();
	const disclosureOpen = ref(false);
	const allowed = ref(false);
	const toggleButton = ref<HTMLButtonElement | null>(null);
	const fixtureAction = computed(() =>
		props.operation === 'discovery' ?
			props.repeat ?
				'Rerun fixture analysis'
			:	'Analyze fixture interview'
		: props.repeat ? 'Regenerate fixture proposal'
		: 'Create fixture proposal',
	);
	const liveAction = computed(() =>
		props.operation === 'discovery' ?
			props.repeat ?
				'Rerun live analysis'
			:	'Analyze with live provider'
		: props.repeat ? 'Regenerate live proposal'
		: 'Create live proposal',
	);

	function clearConsent() {
		disclosureOpen.value = false;
		allowed.value = false;
	}
	function cancel() {
		clearConsent();
		toggleButton.value?.focus();
	}
	watch(
		() => props.disabled,
		(disabled) => {
			if (disabled) {
				clearConsent();
			}
		},
	);
	function runLive() {
		if (!allowed.value || props.disabled) {
			return;
		}
		cancel();
		emit('run', 'live', true);
	}
</script>

<template>
	<div class="run-controls">
		<div class="actions">
			<button
				v-if="fixtureAvailable"
				class="button primary"
				type="button"
				:disabled="disabled"
				@click="
					clearConsent();
					emit('run', 'fixture', false);
				"
			>
				{{ fixtureAction }}
			</button>
			<button
				ref="toggleButton"
				class="button"
				:class="{ primary: !fixtureAvailable }"
				type="button"
				:aria-expanded="disclosureOpen"
				:disabled="disabled"
				@click="disclosureOpen ? cancel() : (disclosureOpen = true)"
			>
				{{ liveAction }}…
			</button>
		</div>
		<form
			v-if="disclosureOpen"
			class="consent stack"
			@submit.prevent="runLive"
			@keydown.esc="cancel"
		>
			<h3>Send source material to the live provider?</h3>
			<p>
				This {{ operation }} request sends the current saved transcript
				and consultant answers to the configured AI provider. It may
				leave this machine. Approval is for this request only.
			</p>
			<label class="checkbox"
				><input
					v-model="allowed"
					type="checkbox"
					:disabled="disabled"
				/>
				I consent to sending this interview material for
				{{ operation }}.</label
			>
			<div class="actions">
				<button
					class="button primary"
					type="submit"
					:disabled="disabled || !allowed"
				>
					Confirm live {{ operation }}
				</button>
				<button
					class="button"
					type="button"
					@click="cancel"
				>
					Cancel
				</button>
			</div>
		</form>
	</div>
</template>

<style scoped>
	.consent {
		padding: 0.9rem;
		margin-top: 0.65rem;
		border: 1px solid #d9c9a2;
		border-radius: 0.4rem;
		background: var(--sand);
	}
	.consent h3,
	.consent p {
		margin: 0;
	}
	.checkbox {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
</style>
