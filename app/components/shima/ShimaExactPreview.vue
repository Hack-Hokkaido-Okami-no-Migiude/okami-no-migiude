<script setup lang="ts">
	import type { ShimaPreview } from '~/composables/useShimaTypes';
	import ShimaPublicTask from './ShimaPublicTask.vue';
	import { yenDisplay } from '~/composables/shimaFormat';

	const props = defineProps<{
		preview: ShimaPreview;
		reviewable: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{
		publish: [
			approval: { confirmBudget: boolean; approvePreview: boolean },
		];
	}>();
	const confirmBudget = ref(false);
	const approvePreview = ref(false);
	const ready = computed(
		() =>
			props.reviewable
			&& !props.disabled
			&& confirmBudget.value
			&& approvePreview.value,
	);

	function publish() {
		if (ready.value) {
			emit('publish', {
				confirmBudget: confirmBudget.value,
				approvePreview: approvePreview.value,
			});
		}
	}
</script>

<template>
	<section
		class="shima-preview"
		aria-labelledby="shima-preview-title"
		data-testid="shima-exact-preview"
	>
		<h3 id="shima-preview-title">
			公開プレビュー：掲示板に表示される全項目
		</h3>
		<p>
			下書きや原文は掲載しません。ここに表示した架空のカードだけを公開します。
		</p>
		<ShimaPublicTask :task="props.preview.task" />
		<p class="quiet fine mono">
			プレビュー照合値：{{ props.preview.hash }}
		</p>
		<fieldset
			class="shima-approvals"
			:disabled="props.disabled || !props.reviewable"
		>
			<legend>公開前の2つの確認</legend>
			<label
				><input
					v-model="confirmBudget"
					type="checkbox"
					data-testid="shima-confirm-yen"
				/>
				確定額
				{{ yenDisplay(props.preview.task.confirmedBudgetYen) }}
				を確認しました</label
			>
			<label
				><input
					v-model="approvePreview"
					type="checkbox"
					data-testid="shima-approve-card"
				/>
				上の全項目を確認し、このカードの公開を承認します</label
			>
			<button
				class="button primary"
				type="button"
				data-testid="shima-publish"
				:disabled="!ready"
				@click="publish"
			>
				この内容で公開する（デモ）
			</button>
		</fieldset>
	</section>
</template>
