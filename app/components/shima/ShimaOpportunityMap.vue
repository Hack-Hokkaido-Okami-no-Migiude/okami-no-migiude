<script setup lang="ts">
	import {
		formatPotentialPerMonth,
		formatSpentPerWeek,
		quantityBasisLabel,
	} from '~/composables/shimaFormat';
	import {
		shimaDemoOpportunityId,
		shimaDemoStepId,
	} from '~/composables/useShimaDemo';
	import type { Session } from '#shared/p0/types';
	import type { ShimaMapView } from '~/composables/useShimaTypes';

	const props = defineProps<{
		session: Session | null;
		map: ShimaMapView | null;
		answered: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{ recordEffort: [] }>();
	const effort = computed(() =>
		props.map?.manualEffort.find((row) => row.stepId === shimaDemoStepId),
	);
	const estimate = computed(
		() =>
			props.map?.opportunities.find(
				(row) => row.opportunityId === shimaDemoOpportunityId,
			)?.estimatedHoursSavedPerMonth ?? null,
	);
	const opportunity = computed(() =>
		props.session?.opportunities.find(
			(item) => item.id === shimaDemoOpportunityId,
		),
	);
</script>

<template>
	<section
		class="shima-panel"
		aria-labelledby="shima-map"
	>
		<p class="shima-kicker">02 / 見える化</p>
		<h2 id="shima-map">清掃予定の抜け漏れを減らす</h2>
		<p v-if="!props.answered">
			補足の回答を記録すると、対象の工程と見積もりを確認できます。
		</p>
		<p
			v-else-if="props.map?.stale"
			class="shima-warning"
			data-testid="shima-map-stale"
		>
			保存した回答に対して見取り図が古くなっています。更新するまでは前回の結果です。
		</p>
		<template v-if="props.answered">
			<ol
				class="shima-process"
				aria-label="対象業務の流れ"
			>
				<li>清掃予定を渡した後に部屋が変更になる</li>
				<li>フロントから清掃担当へ電話する</li>
				<li>清掃担当が予定表を書き直す</li>
			</ol>
			<div class="shima-metrics">
				<article
					class="shima-metric"
					data-testid="shima-weekly-effort"
				>
					<h3>いま使っている時間（週・繁忙期）</h3>
					<strong>{{
						formatSpentPerWeek(effort?.minutesSpentPerWeek ?? null)
					}}</strong>
					<template v-if="effort">
						<p>
							週{{
								effort.weeklyOccurrences.value ?? '不明'
							}}回（{{
								quantityBasisLabel(effort.weeklyOccurrences)
							}}）× 1回{{
								effort.minutesPerOccurrence.value ?? '不明'
							}}分（{{
								quantityBasisLabel(effort.minutesPerOccurrence)
							}}）
						</p>
						<p>{{ effort.weeklyOccurrences.basis }}</p>
						<details>
							<summary>工数の根拠（原文）</summary>
							<blockquote
								v-for="(source, index) in effort
									.weeklyOccurrences.evidence"
								:key="`${source.sourceId}-${index}`"
								lang="en"
							>
								{{ source.quote
								}}<cite
									>補足回答・改訂 {{ source.sourceRev }}</cite
								>
							</blockquote>
						</details>
					</template>
					<p v-else>
						まだ工数を保存していません。不明は0ではありません。
					</p>
					<button
						v-if="!effort"
						class="button"
						type="button"
						data-testid="shima-effort-record"
						:disabled="props.disabled || props.map?.stale"
						@click="emit('recordEffort')"
					>
						週10回 × 15分を工数として記録
					</button>
				</article>
				<article
					class="shima-metric"
					data-testid="shima-monthly-estimate"
				>
					<h3>将来の削減時間の上限（月・試算）</h3>
					<strong>{{ formatPotentialPerMonth(estimate) }}</strong>
					<p>
						繁忙期が4週続き、対象の電話と書き直しをすべて省けるとした場合の上限です。実測値や効果の保証ではありません。
					</p>
					<p>
						実際は結果の確認と、読めない通知やイレギュラー時の手作業が残ります。閑散期の値は不明です。
					</p>
					<details v-if="opportunity?.evidence.length">
						<summary>改善候補の根拠（原文）</summary>
						<blockquote
							v-for="(source, index) in opportunity.evidence"
							:key="`${source.sourceId}-${index}`"
							lang="en"
						>
							{{ source.quote
							}}<cite>原文・改訂 {{ source.sourceRev }}</cite>
						</blockquote>
					</details>
				</article>
			</div>
			<section
				class="shima-checklist"
				aria-labelledby="shima-setup"
			>
				<h3 id="shima-setup">自分たちで試す：共有の変更メモ</h3>
				<p>
					前提：清掃担当とフロントが同じ表を見られること。まず本番の予定表ではなく、架空データを入れた複製で試します。
				</p>
				<ol>
					<li>
						「日付・変更前後の部屋・確認時刻」欄を用意し、更新役と確認役を1人ずつ決めます。
					</li>
					<li>
						サンプルで部屋変更を記録し、確認役が元の予定表を書き換えずに正しい変更を確認できれば合格です。
					</li>
					<li>
						見られない・判断できないときは、電話で復唱し従来どおり手で直します。
					</li>
				</ol>
				<p>
					通知の読み取りや自動転記まで必要な場合だけ、次の工程でエンジニア向けの依頼にします。
				</p>
			</section>
		</template>
	</section>
</template>
