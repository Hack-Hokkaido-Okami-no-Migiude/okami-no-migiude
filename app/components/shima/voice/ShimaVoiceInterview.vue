<script setup lang="ts">
	import { browserSupportsVoice, browserVoiceIO } from './-browserVoiceIO';
	import {
		computed,
		onBeforeUnmount,
		onDeactivated,
		onMounted,
		ref,
		useId,
		watch,
	} from 'vue';
	import { createVoiceInterview, voiceAllowed } from './-voiceInterview';
	import type { VoiceTurnRequest } from './-voiceInterview';

	const props = defineProps<{
		available: boolean;
		consentComplete: boolean;
		notice: string;
		interviewPath: string;
		baseRev: number;
		csrfHeaders?: () => HeadersInit;
		commitTurn: (
			turnsPath: string,
			request: VoiceTurnRequest,
		) => Promise<void>;
	}>();
	const emit = defineEmits<{ revision: [rev: number] }>();
	const id = useId();
	const supported = ref(false);
	const acknowledged = ref(false);
	const correction = ref('');
	const voiceInput = () => ({
		available: props.available && supported.value,
		consentComplete: props.consentComplete,
		notice: props.notice,
		interviewPath: props.interviewPath,
		baseRev: props.baseRev,
	});
	const client = createVoiceInterview(
		voiceInput,
		browserVoiceIO(() => props.csrfHeaders?.()),
		{
			onRevision: (rev) => emit('revision', rev),
			commitTurn: (path, body) => props.commitTurn(path, body),
		},
	);
	const { state } = client;
	const canStart = computed(() => voiceAllowed(voiceInput()));
	const status = computed(() => {
		if (state.playing) {
			return '質問の音声を再生しています。マイクは一時停止中です。';
		}
		switch (state.phase) {
			case 'starting':
				return '音声インタビューを開始しています。';
			case 'connecting':
				return '音声接続の準備を待っています。';
			case 'permission':
				return 'マイクの許可を確認しています。';
			case 'listening':
				return state.question ? 'マイクで回答を受け付けています。' : (
						'質問を待っています。'
					);
			case 'finishing':
				return 'マイクを停止しました。回答の下書きを待っています。';
			case 'draft':
				return 'マイクは停止中です。下書きを確認・修正してください。';
			case 'stopping':
				return state.stopUnconfirmed ?
						'マイクと接続は閉じました。サーバーの停止を確認できませんでした。'
					:	'サーバーに停止を要求しています。';
			default:
				return '';
		}
	});

	function start() {
		const confirmed = acknowledged.value;
		acknowledged.value = false;
		void client.start(confirmed);
	}

	function exit() {
		acknowledged.value = false;
		void client.stop();
	}

	watch(
		() => [
			props.available,
			props.consentComplete,
			props.notice,
			props.interviewPath,
		],
		exit,
		{ flush: 'sync' },
	);
	watch(
		() => state.phase,
		(phase) => {
			correction.value = phase === 'draft' ? state.draft : '';
		},
		{ flush: 'sync' },
	);
	onMounted(() => {
		supported.value = browserSupportsVoice();
		window.addEventListener('pagehide', exit);
	});
	onDeactivated(exit);
	onBeforeUnmount(() => {
		window.removeEventListener('pagehide', exit);
		client.dispose();
	});
</script>

<template>
	<section
		v-if="canStart || state.phase !== 'idle' || state.message"
		:aria-labelledby="`${id}-title`"
	>
		<h2 :id="`${id}-title`">音声インタビュー</h2>
		<div v-if="canStart && state.phase === 'idle'">
			<p class="voice-notice">{{ notice }}</p>
			<p>音声の代わりに文字で回答できます。</p>
			<p>
				<label>
					<input
						v-model="acknowledged"
						type="checkbox"
					/>
					案内を読み、今回の音声インタビューを開始することを確認しました。
				</label>
			</p>
			<button
				type="button"
				:disabled="!acknowledged"
				@click="start"
			>
				音声で始める
			</button>
		</div>

		<p
			v-if="status"
			role="status"
		>
			{{ status }}
		</p>
		<p
			v-if="state.message"
			role="status"
		>
			{{ state.message }}
		</p>
		<p v-if="state.question">
			<strong>質問：</strong>{{ state.question.text }}
		</p>
		<p v-if="state.partial">
			<strong>文字起こし中（未保存）：</strong>{{ state.partial }}
		</p>

		<button
			v-if="
				state.phase === 'listening' && state.question && !state.playing
			"
			type="button"
			@click="client.finish()"
		>
			話し終える・下書きを確認
		</button>
		<div v-if="state.phase === 'draft'">
			<label :for="`${id}-correction`">
				{{
					state.draftLocked ? '確認した回答' : (
						'回答の下書き（未保存）'
					)
				}}
			</label>
			<textarea
				:id="`${id}-correction`"
				v-model="correction"
				rows="5"
				:disabled="state.saving || state.draftLocked"
			/>
			<button
				type="button"
				:disabled="state.saving || !correction.trim()"
				@click="client.submit(correction)"
			>
				{{ state.draftLocked ? '保存を再試行' : '確認した回答を保存' }}
			</button>
		</div>

		<button
			v-if="
				state.phase !== 'idle'
				&& (state.phase !== 'stopping' || state.stopUnconfirmed)
			"
			type="button"
			@click="exit"
		>
			{{
				state.stopUnconfirmed ? '停止を再試行'
				: state.phase === 'draft' && !state.draftLocked ?
					'下書きを破棄して停止'
				:	'音声を停止'
			}}
		</button>
	</section>
</template>

<style scoped>
	.voice-notice {
		white-space: pre-wrap;
	}
	textarea {
		display: block;
		width: 100%;
	}
</style>
