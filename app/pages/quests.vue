<script setup lang="ts">
	import type {
		ShimaQuestDetail,
		ShimaQuestSummary,
	} from '~/composables/useShimaTypes';
	import { questStateLabel, yenDisplay } from '~/composables/shimaFormat';
	import { PublicTaskSchema } from '#shared/shima/schemas';
	import ShimaPublicTask from '~/components/shima/ShimaPublicTask.vue';
	import { shimaProblem } from '~/composables/useShimaPresentation';
	import { useShimaSurface } from '~/composables/useShimaSurface';

	definePageMeta({ layout: false });
	useHead({ title: 'シマエナガ｜依頼掲示板', htmlAttrs: { lang: 'ja' } });
	const surface = useShimaSurface();
	const demoBoard = computed(
		() =>
			surface.value === 'fixture-local'
			|| surface.value === 'public-demo',
	);
	const route = useRoute();
	const board = shallowRef<ShimaQuestSummary[]>([]);
	const detail = shallowRef<ShimaQuestDetail | null>(null);
	const busy = ref(false);
	const loaded = ref(false);
	const notice = ref('');
	const problem = ref('');
	const selectedId = ref<string | null>(null);

	async function readDetail(questId: string) {
		const response = await $fetch<ShimaQuestDetail>(
			`/api/quests/${encodeURIComponent(questId)}`,
			{ retry: 0 },
		);
		if (
			response.id !== questId
			|| !PublicTaskSchema.safeParse(response.task).success
		) {
			throw new Error('Invalid public task');
		}
		return response;
	}

	async function readBoard(questId: string | null) {
		// The fixture list read also establishes the synthetic claimant cookie.
		const entries = await $fetch<ShimaQuestSummary[]>('/api/quests', {
			retry: 0,
		});
		board.value = entries;
		loaded.value = true;
		detail.value = null;
		selectedId.value = null;
		if (questId && entries.some((entry) => entry.id === questId)) {
			detail.value = await readDetail(questId);
			selectedId.value = questId;
		}
		return detail.value;
	}

	async function run(label: string, action: () => Promise<void>) {
		if (busy.value || !demoBoard.value) {
			return;
		}
		busy.value = true;
		problem.value = '';
		notice.value = label;
		try {
			await action();
			if (notice.value === label) {
				notice.value = '';
			}
		} catch (error) {
			notice.value = '';
			problem.value = shimaProblem(error);
		} finally {
			busy.value = false;
		}
	}

	function refresh() {
		const focus =
			selectedId.value
			?? (typeof route.query.q === 'string' ? route.query.q : null);
		return run('掲示板を読み込んでいます…', async () => {
			detail.value = null;
			await readBoard(focus);
		});
	}

	function open(questId: string) {
		return run('依頼を読み込んでいます…', async () => {
			detail.value = null;
			detail.value = await readDetail(questId);
			selectedId.value = questId;
		});
	}

	function claim() {
		const target = detail.value;
		if (!target || target.state !== 'available') {
			return;
		}
		return run('申し込みを送信しています…', async () => {
			detail.value = null;
			try {
				await $fetch(
					`/api/quests/${encodeURIComponent(target.id)}/claim`,
					{
						method: 'POST',
						body: { baseRev: target.rev },
						headers: { 'Idempotency-Key': crypto.randomUUID() },
						retry: 0,
					},
				);
			} catch (error) {
				await readBoard(target.id).catch(() => undefined);
				throw error;
			}
			const confirmed = await readBoard(target.id);
			if (confirmed?.id !== target.id || confirmed.state !== 'claimed') {
				throw new Error('Claim not confirmed');
			}
			notice.value = 'デモの申し込みを記録しました。';
		});
	}

	onMounted(refresh);
	watch(
		() => route.query.q,
		() => {
			selectedId.value = null;
			void refresh();
		},
	);
</script>

<template>
	<main class="shima-shell">
		<header class="shima-hero">
			<p class="shima-kicker">シマエナガ</p>
			<h1>依頼掲示板</h1>
		</header>
		<p
			v-if="!demoBoard"
			class="shima-panel"
			data-testid="shima-board-closed"
		>
			この画面から掲示板を利用することはできません。
		</p>
		<template v-else>
			<div class="shima-lane">
				<strong
					class="shima-tag"
					data-testid="shima-fictional-label"
					>架空のデモ・実発注なし</strong
				>
				<NuxtLink
					v-if="surface === 'fixture-local'"
					to="/"
					>オーナーページへ</NuxtLink
				>
			</div>
			<p
				class="shima-status"
				role="status"
				aria-atomic="true"
			>
				{{ notice }}
			</p>
			<p
				v-if="problem"
				class="shima-warning"
				role="alert"
			>
				{{ problem }}
			</p>
			<section
				class="shima-panel"
				aria-labelledby="shima-board-title"
				:aria-busy="busy"
			>
				<h2 id="shima-board-title">依頼の一覧</h2>
				<button
					class="button"
					type="button"
					data-testid="shima-board-refresh"
					:disabled="busy"
					@click="refresh"
				>
					掲示板を更新
				</button>
				<p v-if="loaded && !board.length && !problem">
					公開中の依頼はありません。
				</p>
				<ul
					v-if="board.length"
					class="shima-entries"
				>
					<li
						v-for="entry in board"
						:key="entry.id"
					>
						<button
							class="button shima-entry"
							type="button"
							data-testid="shima-quest-open"
							:aria-pressed="detail?.id === entry.id"
							:disabled="busy"
							@click="open(entry.id)"
						>
							<strong>{{ entry.title }}</strong>
							<span
								>{{ yenDisplay(entry.confirmedBudgetYen) }}・{{
									entry.targetDate
								}}・{{ questStateLabel(entry.state) }}</span
							>
						</button>
					</li>
				</ul>
			</section>
			<section
				v-if="detail"
				class="shima-panel"
				aria-labelledby="shima-quest-title"
				data-testid="shima-quest-detail"
			>
				<h2 id="shima-quest-title">{{ detail.task.title }}</h2>
				<p
					class="shima-tag"
					data-testid="shima-quest-state"
				>
					{{ questStateLabel(detail.state) }}
				</p>
				<ShimaPublicTask :task="detail.task" />
				<button
					v-if="detail.state === 'available'"
					class="button primary"
					type="button"
					data-testid="shima-quest-claim"
					:disabled="busy"
					@click="claim"
				>
					受け持つ（デモ）
				</button>
				<p v-else>
					担当が決まったため、この依頼にはもう申し込めません。
				</p>
			</section>
		</template>
	</main>
</template>

<style lang="scss">
	@use '../styles/shima.scss';
</style>
