<!-- Owner-only consultation request card. Hidden for staff viewers; state is
     returned by the API and reflected here. -->
<template>
	<section class="panel report-consultation">
		<p class="eyebrow">
			{{ copy.title }}
		</p>
		<p class="report-consultation__body">
			{{ copy.body }}
		</p>
		<p
			v-if="requestedAtLabel"
			class="report-consultation__state"
		>
			<span class="badge text-bg-success">{{ copy.requested }}</span>
			<span> {{ copy.requestedAtLabel }}: {{ requestedAtLabel }} </span>
		</p>
		<button
			v-else
			type="button"
			class="button-primary"
			:disabled="requesting"
			@click="emit('request')"
		>
			{{ requesting ? copy.requesting : copy.button }}
		</button>
		<p
			v-if="notice"
			class="notice report-consultation__notice"
			role="status"
		>
			{{ notice }}
		</p>
		<p class="report-consultation__note">
			{{ copy.note }}
		</p>
	</section>
</template>

<script lang="ts" setup>
	import type { ReportPageCopy } from '~/locales/report';

	defineProps<{
		copy: ReportPageCopy['consultation'];
		requestedAtLabel: string | null;
		requesting: boolean;
		notice: string | null;
	}>();

	const emit = defineEmits<{ request: [] }>();
</script>

<style lang="scss" scoped>
	.report-consultation {
		&__body {
			margin: 0 0 0.75rem;
		}

		&__state {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin: 0 0 0.75rem;
		}

		&__notice {
			margin: 0.75rem 0 0;
		}

		&__note {
			font-size: 0.85rem;
			opacity: 0.75;
			margin: 0.75rem 0 0;
		}
	}
</style>
