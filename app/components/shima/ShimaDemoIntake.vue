<script setup lang="ts">
	import type { Answer } from '#shared/p0/types';
	import ShimaRoleplayAudio from '~/components/shima/roleplay/ShimaRoleplayAudio.vue';
	import { shimaDemoQuestion } from '~/composables/useShimaDemo';

	const props = defineProps<{
		ready: boolean;
		answer: Answer | null;
		stale: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{ open: []; answer: [] }>();
</script>

<template>
	<section
		class="shima-panel"
		aria-labelledby="shima-hear"
	>
		<p class="shima-kicker">01 / 聞く</p>
		<h2 id="shima-hear">部屋変更の仕事を聞く</h2>
		<p>
			架空の宿では、清掃予定を渡した後に部屋が変わると、電話で伝えて予定表を書き直します。
		</p>
		<p class="quiet">
			質問は文字でも表示します。録音は事前録音の架空ボイスで、マイクも外部AIも使いません。
		</p>
		<ShimaRoleplayAudio />
		<button
			v-if="!props.ready"
			class="button primary"
			type="button"
			data-testid="shima-demo-open"
			:disabled="props.disabled"
			@click="emit('open')"
		>
			デモを開く
		</button>
		<div
			v-else
			class="shima-question"
		>
			<p class="shima-kicker">シマエナガからの質問・文字表示</p>
			<p data-testid="shima-demo-question">
				<strong>{{ shimaDemoQuestion }}</strong>
			</p>
			<p>
				台本の回答：繁忙期は週に約10回。電話と予定表の修正に、合わせて1回約15分かかります。
			</p>
			<button
				v-if="!props.answer || props.stale"
				class="button primary"
				type="button"
				data-testid="shima-demo-answer"
				:disabled="props.disabled"
				@click="emit('answer')"
			>
				{{
					props.answer ? '保存済みの回答で見取り図を更新' : (
						'台本の回答を記録して見取り図を更新'
					)
				}}
			</button>
			<details v-if="props.answer">
				<summary>記録済みの回答（原文）</summary>
				<blockquote lang="en">{{ props.answer.text }}</blockquote>
			</details>
		</div>
	</section>
</template>
