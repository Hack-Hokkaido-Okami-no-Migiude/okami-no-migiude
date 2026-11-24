<script setup lang="ts">
	import type {
		ShimaPackageView,
		ShimaPreview,
		ShimaQuestDetail,
	} from '~/composables/useShimaTypes';
	import {
		canShowShimaApprovals,
		shimaCompleted,
		shimaIntent,
		shimaPublished,
	} from '~/composables/useShimaPresentation';
	import ShimaExactPreview from './ShimaExactPreview.vue';
	import { yenDisplay } from '~/composables/shimaFormat';

	const props = defineProps<{
		package: ShimaPackageView | null;
		preview: ShimaPreview | null;
		quest: ShimaQuestDetail | null;
		ready: boolean;
		stale: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{
		create: [];
		decide: [decision: 'accept' | 'decline'];
		reshape: [
			fields: {
				proposedBudgetYen: number | null;
				targetDate: string | null;
			},
		];
		preview: [];
		publish: [
			approval: { confirmBudget: boolean; approvePreview: boolean },
		];
		refresh: [];
		complete: [criteriaConfirmed: boolean];
	}>();

	const intent = computed(() =>
		props.package ? shimaIntent(props.package) : null,
	);
	const published = computed(() =>
		props.package ? shimaPublished(props.package) : false,
	);
	const completed = computed(() =>
		props.package ? shimaCompleted(props.package) : false,
	);
	const claimed = computed(
		() =>
			props.quest?.state === 'claimed'
			&& props.quest.id === props.package?.questId,
	);
	const reviewable = computed(
		() =>
			!props.stale && canShowShimaApprovals(props.package, props.preview),
	);
	const editing = ref(false);
	const budget = ref<string | number>('');
	const due = ref('');
	const criteriaConfirmed = ref(false);
	const criteria = computed(() =>
		claimed.value ? (props.quest?.task.acceptanceCriteria ?? []) : [],
	);
	const catalogConditions = {
		proposedBudgetYen: 80000,
		targetDate: '2026-12-18',
	};
	const catalogReady = computed(
		() =>
			props.package?.draft.proposedBudgetYen
				=== catalogConditions.proposedBudgetYen
			&& props.package.draft.targetDate === catalogConditions.targetDate,
	);
	const privateLists = computed(() => {
		const draft = props.package?.draft;
		return draft ?
				[
					{ label: '成果物', values: draft.deliverables },
					{ label: '受け入れ条件', values: draft.acceptanceCriteria },
					{ label: '必要なスキル', values: draft.skills },
					{ label: '連携先・依存関係', values: draft.integrations },
					{ label: '前提条件', values: draft.prerequisites },
				]
			:	[];
	});

	watch(
		() => props.package,
		() => {
			editing.value = false;
		},
	);
	watch(
		() => props.quest,
		() => {
			criteriaConfirmed.value = false;
		},
	);

	function startReshape() {
		if (!props.package || published.value) {
			return;
		}
		budget.value =
			props.package.draft.proposedBudgetYen
			?? catalogConditions.proposedBudgetYen;
		due.value =
			props.package.draft.targetDate ?? catalogConditions.targetDate;
		editing.value = true;
	}

	function saveReshape() {
		if (
			!editing.value
			|| props.disabled
			|| props.stale
			|| published.value
		) {
			return;
		}
		const proposedBudgetYen =
			budget.value === '' ? null : Number(budget.value);
		if (
			proposedBudgetYen !== null
			&& (!Number.isSafeInteger(proposedBudgetYen)
				|| proposedBudgetYen < 0
				|| proposedBudgetYen > 100_000_000)
		) {
			return;
		}
		emit('reshape', { proposedBudgetYen, targetDate: due.value || null });
	}
</script>

<template>
	<section
		class="shima-panel"
		aria-labelledby="shima-match"
	>
		<p class="shima-kicker">03 / つなぐ</p>
		<h2 id="shima-match">必要なところだけ、依頼にする</h2>
		<p>このデモでは実際の発注・支払い・補助金申請は行いません。</p>
		<template v-if="!props.package">
			<p v-if="!props.ready">
				回答と最新の見取り図がそろうと、下書きを作れます。
			</p>
			<button
				class="button primary"
				type="button"
				data-testid="shima-create-package"
				:disabled="props.disabled || !props.ready || props.stale"
				@click="emit('create')"
			>
				依頼の下書きを作成
			</button>
		</template>
		<template v-else>
			<div class="shima-row">
				<span
					class="shima-tag"
					data-testid="shima-package-state"
					>{{
						published ?
							claimed ? '担当決定・編集不可'
							:	'公開済み・編集不可'
						: intent === 'declined' ? '見送り（非公開）'
						: intent === 'accepted' ? '引き受ける意向（非公開）'
						: '下書き（非公開）'
					}}</span
				>
				<span
					v-if="completed"
					class="shima-tag"
					data-testid="shima-private-complete"
					>完了（オーナーのみ）</span
				>
			</div>
			<div
				v-if="props.package.stale"
				class="shima-warning"
				data-testid="shima-package-stale"
			>
				<p>
					提案の根拠が変わりました。{{
						published ? '公開済みカードは編集できません。' : (
							'最新の根拠を反映するまで判断や公開はできません。'
						)
					}}
				</p>
				<button
					v-if="!published"
					class="button"
					type="button"
					data-testid="shima-package-rebase"
					:disabled="props.disabled || props.stale || !props.ready"
					@click="emit('create')"
				>
					最新の根拠を反映する
				</button>
			</div>
			<details :open="!published">
				<summary>依頼の下書き（非公開）</summary>
				<h3>{{ props.package.draft.title }}</h3>
				<p>{{ props.package.draft.problem }}</p>
				<dl class="shima-task-fields">
					<div>
						<dt>変更内容</dt>
						<dd>{{ props.package.draft.proposedChange }}</dd>
					</div>
					<div
						v-for="entry in privateLists"
						:key="entry.label"
					>
						<dt>{{ entry.label }}</dt>
						<dd>
							<ul v-if="entry.values.length">
								<li
									v-for="(value, index) in entry.values"
									:key="index"
								>
									{{ value }}
								</li>
							</ul>
							<template v-else>未設定</template>
						</dd>
					</div>
					<div>
						<dt>提案額（非公開・目安）</dt>
						<dd>
							{{
								props.package.draft.proposedBudgetYen === null ?
									'未設定'
								:	yenDisplay(
										props.package.draft.proposedBudgetYen,
									)
							}}
						</dd>
					</div>
					<div>
						<dt>希望期日</dt>
						<dd>
							{{ props.package.draft.targetDate ?? '未設定' }}
						</dd>
					</div>
				</dl>
				<p>
					削減時間の試算とその条件は上の見取り図を参照してください。
				</p>
			</details>
			<template v-if="!published && !completed">
				<p>
					「引き受ける」は非公開の意向です。公開の承認や契約にはなりません。見送った依頼は条件を調整してから開き直せます。
				</p>
				<div class="shima-row">
					<button
						class="button primary"
						type="button"
						data-testid="shima-decision-accept"
						:disabled="
							props.disabled
							|| props.stale
							|| props.package.stale
							|| !!intent
							|| editing
						"
						@click="emit('decide', 'accept')"
					>
						引き受ける
					</button>
					<button
						class="button"
						type="button"
						data-testid="shima-reshape"
						:disabled="
							props.disabled
							|| props.stale
							|| props.package.stale
							|| editing
						"
						@click="startReshape"
					>
						内容を調整
					</button>
					<button
						class="button"
						type="button"
						data-testid="shima-decision-decline"
						:disabled="
							props.disabled
							|| props.stale
							|| props.package.stale
							|| !!intent
							|| editing
						"
						@click="emit('decide', 'decline')"
					>
						見送る
					</button>
				</div>
				<form
					v-if="editing"
					class="shima-form"
					@submit.prevent="saveReshape"
				>
					<p>
						保存すると前の判断と公開確認は取り消されます。この架空カードの指定条件は、{{
							yenDisplay(catalogConditions.proposedBudgetYen)
						}}・{{ catalogConditions.targetDate }} です。
					</p>
					<div class="shima-row">
						<label
							>提案額（円）<input
								v-model="budget"
								type="number"
								min="0"
								max="100000000"
								step="1"
								data-testid="shima-draft-yen"
						/></label>
						<label
							>希望期日<input
								v-model="due"
								type="date"
								data-testid="shima-draft-date"
						/></label>
					</div>
					<div class="shima-row">
						<button
							class="button primary"
							type="submit"
							data-testid="shima-reshape-save"
							:disabled="props.disabled || props.stale"
						>
							条件を保存
						</button>
						<button
							class="button"
							type="button"
							:disabled="props.disabled"
							@click="editing = false"
						>
							取り消す
						</button>
					</div>
				</form>
				<template v-if="intent === 'accepted'">
					<p v-if="!catalogReady">
						このデモで公開できるのは
						{{
							yenDisplay(catalogConditions.proposedBudgetYen)
						}}・{{ catalogConditions.targetDate }}
						の架空カードだけです。「内容を調整」で条件を保存してください。
					</p>
					<button
						v-if="!props.preview"
						class="button"
						type="button"
						data-testid="shima-preview-prepare"
						:disabled="
							props.disabled
							|| props.stale
							|| props.package.stale
							|| editing
							|| !catalogReady
						"
						@click="emit('preview')"
					>
						公開プレビューを準備
					</button>
				</template>
				<ShimaExactPreview
					v-if="props.preview && !editing"
					:key="props.preview.id + props.preview.hash"
					:preview="props.preview"
					:reviewable="reviewable"
					:disabled="props.disabled"
					@publish="emit('publish', $event)"
				/>
			</template>
			<template v-else>
				<NuxtLink
					v-if="props.package.questId"
					class="button"
					:to="{
						path: '/quests',
						query: { q: props.package.questId },
					}"
					data-testid="shima-published-quest"
					>掲示板で依頼を見る</NuxtLink
				>
				<button
					v-if="!completed"
					class="button"
					type="button"
					data-testid="shima-refresh-claim"
					:disabled="props.disabled"
					@click="emit('refresh')"
				>
					申し込み状況を更新
				</button>
				<section
					v-if="claimed && !completed && !props.package.stale"
					class="shima-checklist"
					aria-labelledby="shima-complete-title"
				>
					<h3 id="shima-complete-title">
						受け入れ確認（オーナーのみ）
					</h3>
					<p>
						成果物を確認したら完了を記録できます。支払いや認証ではありません。
					</p>
					<ul>
						<li
							v-for="(criterion, index) in criteria"
							:key="index"
						>
							{{ criterion }}
						</li>
					</ul>
					<label
						><input
							v-model="criteriaConfirmed"
							type="checkbox"
							data-testid="shima-confirm-criteria"
							:disabled="props.disabled || !criteria.length"
						/>
						すべての受け入れ条件を確認しました</label
					>
					<button
						class="button primary"
						type="button"
						data-testid="shima-complete"
						:disabled="
							props.disabled
							|| !criteriaConfirmed
							|| !criteria.length
						"
						@click="emit('complete', criteriaConfirmed)"
					>
						完了を記録
					</button>
				</section>
			</template>
		</template>
	</section>
</template>
