<script setup lang="ts">
		import { questStateLabel, yenDisplay } from '../composables/shimaFormat';
		import type { PublicTask } from '#shared/shima/schemas';

	// The public engineer board: the stable summary list, the exact published
	// task detail, and the single-winner claim button. Same-origin only; the
	// demo-engineer cookie is issued by the board read itself.
	type QuestSummary = {
		id: string;
		rev: number;
		state: 'available' | 'claimed';
		title: string;
		confirmedBudgetYen: number;
		targetDate: string | null;
	};

	type QuestDetail = {
		id: string;
		rev: number;
		state: 'available' | 'claimed';
		task: PublicTask;
	};

	const route = useRoute();
	const busy = ref(false);
	const problem = ref('');
	const notice = ref('');
	const board = ref<QuestSummary[]>([]);
	const detail = ref<QuestDetail | null>(null);

	useHead({
		title: 'しま掲示板（フィクション工事デモ）',
		htmlAttrs: { lang: 'ja' },
	});

	function messageOf(error: unknown): string {
		const data = (error as { data?: { error?: { message?: string } } })?.data;
		return data?.error?.message ?? '操作に失敗しました。';
	}

	async function refresh() {
		board.value = await $fetch<QuestSummary[]>('/api/quests');
		const focus = route.query.q;
		const focusId = typeof focus === 'string' ? focus : null;
		if (focusId && board.value.some((entry) => entry.id === focusId)) {
			await open(focusId);
		}
	}

	async function open(questId: string) {
		detail.value = await $fetch<QuestDetail>(`/api/quests/${questId}`);
	}

	async function claim() {
		if (!detail.value) {
			return;
		}
		busy.value = true;
		problem.value = '';
		notice.value = '受け持っています…';
		try {
			await $fetch(`/api/quests/${detail.value.id}/claim`, {
				method: 'POST',
				body: { baseRev: detail.value.rev },
				headers: { 'idempotency-key': crypto.randomUUID() },
			});
			await refresh();
			notice.value = '受け持ちました。';
		} catch (error) {
			problem.value = messageOf(error);
			await refresh();
		} finally {
			busy.value = false;
			notice.value = '';
		}
	}

	onMounted(() => {
		void refresh();
	});
</script>

<template>
	<div class="quests-page">
		<header class="quests-heading">
			<div>
				<p class="eyebrow">しま掲示板 / 公開タスク</p>
				<h1>受け持ち可能な工事（デモ）</h1>
			</div>
			<div class="actions">
				<span class="fixture-tag">フィクション・デモ — 実発注なし</span>
				<NuxtLink
					class="pill"
					to="/shima"
					>オーナーページへ</NuxtLink
				>
			</div>
		</header>
		<p
			v-if="problem"
			class="problem"
			role="alert"
		>
			{{ problem }}
		</p>
		<p
			v-else-if="notice"
			class="quiet"
		>
			{{ notice }}
		</p>

		<ul class="plain board">
			<li
				v-for="entry in board"
				:key="entry.id"
			>
				<button
					class="entry"
					type="button"
					@click="open(entry.id)"
				>
					<span class="title">{{ entry.title }}</span>
					<span class="quiet fine mono">{{ yenDisplay(entry.confirmedBudgetYen) }}</span>
					<span class="pill">{{ questStateLabel(entry.state) }}</span>
				</button>
			</li>
		</ul>
		<p
			v-if="!board.length"
			class="quiet"
		>
			公開中のタスクはありません。
		</p>

		<section
			v-if="detail"
			class="detail"
		>
			<h2>{{ detail.task.title }}</h2>
			<p class="quiet fine mono">
				{{ detail.id }}・改訂 {{ detail.rev }}・
				{{ questStateLabel(detail.state) }}
			</p>
			<dl>
				<dt>困りごと</dt>
				<dd>{{ detail.task.problem }}</dd>
				<dt>変更内容</dt>
				<dd>{{ detail.task.proposedChange }}</dd>
				<dt>確定額</dt>
				<dd>{{ yenDisplay(detail.task.confirmedBudgetYen) }}</dd>
				<dt>期日</dt>
				<dd>{{ detail.task.targetDate }}</dd>
				<dt>作れるもの</dt>
				<dd>
					<ul class="plain">
						<li
							v-for="item in detail.task.deliverables"
							:key="item"
						>
							{{ item }}
						</li>
					</ul>
				</dd>
				<dt>受け入れ条件</dt>
				<dd>
					<ul class="plain">
						<li
							v-for="item in detail.task.acceptanceCriteria"
							:key="item"
						>
							{{ item }}
						</li>
					</ul>
				</dd>
				<dt>必要なこと</dt>
				<dd>
					<ul class="plain">
						<li
							v-for="item in detail.task.skills"
							:key="item"
						>
							{{ item }}
						</li>
					</ul>
				</dd>
			</dl>
			<button
				class="primary"
				:disabled="busy || detail.state !== 'available'"
				@click="claim"
			>
				受け持つ
			</button>
		</section>
	</div>
</template>

<style scoped>
	.quests-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 60rem;
	}
	.quests-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.board {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.entry {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border, #ddd);
		border-radius: 0.5rem;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.entry .title {
		flex: 1;
		font-weight: 600;
	}
	.detail {
		border: 1px solid var(--border, #ddd);
		border-radius: 0.5rem;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.detail dt {
		font-weight: 600;
		margin-top: 0.5rem;
	}
	.detail dd {
		margin: 0.25rem 0 0;
	}
	.problem {
		color: var(--danger, #b3261e);
	}
</style>
