<script setup lang="ts">
	import type { PublicTask } from '#shared/shima/schemas';
	import { publicTaskFields } from '~/composables/useShimaPresentation';

	const props = defineProps<{ task: PublicTask }>();
	const fields = computed(() => publicTaskFields(props.task));
</script>

<template>
	<dl
		class="shima-task-fields"
		data-testid="shima-public-task"
	>
		<div
			v-for="field in fields"
			:key="field.key"
			:data-task-field="field.key"
		>
			<dt>{{ field.label }}</dt>
			<dd v-if="Array.isArray(field.value)">
				<ul v-if="field.value.length">
					<li
						v-for="(value, index) in field.value"
						:key="index"
					>
						{{ value }}
					</li>
				</ul>
				<template v-else>なし</template>
			</dd>
			<dd v-else>{{ field.value }}</dd>
		</div>
	</dl>
</template>
