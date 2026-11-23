<script setup lang="ts">
	import type {
		Assumption,
		EvidenceRef,
		Session,
	} from '#shared/p0/types';
	import {
		type AssumptionKey,
		type AssumptionsPatch,
		type EvidenceSource,
		type PlanPatch,
		claimStateLabel,
	} from '../../composables/workbenchDescriptors';
	import AssumptionEditor from './AssumptionEditor.vue';
	import EvidenceLinks from './EvidenceLinks.vue';
	import { FACTOR_NAMES } from '#shared/p0/schemas';
	import PlanComparison from './PlanComparison.vue';
	import PlanEditor from './PlanEditor.vue';
	import RunControls from './RunControls.vue';
	import type { RunMode } from '#shared/p0/api';
	import { proposalBlocked } from '../../composables/workbenchPolicy';
	import { rankOpportunities } from '../../composables/opportunityRanking';

	const props = defineProps<{
		session: Session;
		sources: EvidenceSource[];
		disabled: boolean;
		saveAssumptions: (
			id: string,
			fields: AssumptionsPatch,
		) => Promise<boolean>;
		savePlan: (id: string, patch: PlanPatch) => Promise<boolean>;
		download: (id: string) => Promise<boolean>;
		run: (mode: RunMode, allow: boolean, id: string) => Promise<boolean>;
	}>();
	const emit = defineEmits<{ jump: [reference: EvidenceRef] }>();
	const selectedId = ref('');
	const editor = ref<{ dirty: boolean } | null>(null);
	const estimates = ref<{ dirty: boolean }[]>([]);
	const strategyLabels = {
		simplify: 'Simplify',
		rules: 'Rules-based',
		integration: 'Integration',
		ai: 'AI',
	};
	const assumptionLabels = {
		monthlyOccurrences: 'Monthly occurrences',
		minutesSaved: 'Minutes saved per occurrence',
	} satisfies Record<AssumptionKey, string>;
	const categories = {
		benefits: 'Benefits',
		prerequisites: 'Prerequisites',
		risks: 'Risks',
		unknowns: 'Unknowns',
	} as const;
	const ranked = computed(() =>
		rankOpportunities(props.session.opportunities),
	);
	const opportunity = computed(() =>
		props.session.opportunities.find(({ id }) => id === selectedId.value),
	);
	const proposal = computed(() =>
		props.session.proposals.find(
			({ opportunityId }) => opportunityId === selectedId.value,
		),
	);
	const orphaned = computed(() =>
		props.session.proposals.filter(
			({ opportunityId }) =>
				!props.session.opportunities.some(
					({ id }) => id === opportunityId,
				),
		),
	);
	const blocked = computed(
		() =>
			!opportunity.value
			|| !proposal.value
			|| proposalBlocked(props.session.discovery, proposal.value),
	);
	const canPropose = computed(
		() =>
			props.session.discovery !== null && !props.session.discovery.stale,
	);
	const formatHours = new Intl.NumberFormat('en', {
		maximumFractionDigits: 2,
	});

	function select(id: string) {
		if (selectedId.value === id) {
			return;
		}
		if (
			(editor.value?.dirty
				|| estimates.value.some((estimate) => estimate.dirty))
			&& !window.confirm(
				'Discard unsaved edits to this opportunity or plan?',
			)
		) {
			return;
		}
		selectedId.value = id;
	}
	watch(
		[ranked, orphaned],
		() => {
			if (!opportunity.value && !proposal.value) {
				selectedId.value =
					ranked.value[0]?.item.id
					?? orphaned.value[0]?.opportunityId
					?? '';
			}
		},
		{ immediate: true },
	);

	function saveAssumption(
		key: AssumptionKey,
		value: Omit<Assumption, 'edited'>,
	) {
		return props.saveAssumptions(selectedId.value, { [key]: value });
	}
</script>

<template>
	<section
		class="panel opportunities"
		aria-labelledby="opportunities-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">Response design</p>
				<h2 id="opportunities-heading">Opportunities &amp; plans</h2>
			</div>
		</div>
		<p
			v-if="!ranked.length && !orphaned.length"
			class="empty"
		>
			No opportunities yet. Run discovery to assess where work can be
			simplified or automated.
		</p>
		<template v-if="ranked.length">
			<p class="quiet fine">
				Ranked by the mean of known factors; lower effort and risk rank
				higher. Unknowns do not count against a candidate.
			</p>
			<ol
				class="ranked"
				aria-label="Ranked opportunities"
				role="list"
			>
				<li
					v-for="({ item, score, known }, index) in ranked"
					:key="item.id"
				>
					<button
						class="ranked-choice"
						type="button"
						:aria-pressed="selectedId === item.id"
						@click="select(item.id)"
					>
						<span
							class="rank-number mono"
							aria-hidden="true"
							>{{ String(index + 1).padStart(2, '0') }}</span
						>
						<span
							><strong>{{ item.title }}</strong
							><small
								>{{ strategyLabels[item.strategy] }} ·
								{{
									score === null ?
										'Insufficient evidence to score'
									:	`${score.toFixed(2)} / 3 · ${known} of ${FACTOR_NAMES.length} factors`
								}}</small
							></span
						>
					</button>
				</li>
			</ol>
		</template>
		<div
			v-if="orphaned.length"
			class="actions orphans"
		>
			<span class="fine quiet">Retained plans:</span>
			<button
				v-for="(item, index) in orphaned"
				:key="item.plan.id"
				class="button"
				type="button"
				:aria-pressed="item.opportunityId === selectedId"
				@click="select(item.opportunityId)"
			>
				Detached plan {{ index + 1 }}
			</button>
		</div>
		<div
			v-if="opportunity"
			:key="opportunity.id"
			class="opportunity-detail"
		>
			<h3>{{ opportunity.title }}</h3>
			<p>{{ opportunity.rationale }}</p>
			<p class="quiet fine">
				<strong>Affected work:</strong>
				{{
					session.workflow.steps
						.filter((step) =>
							opportunity?.stepIds.includes(step.id),
						)
						.map((step) => step.label.value ?? 'Unnamed finding')
						.join(' · ')
				}}
			</p>
			<EvidenceLinks
				:references="opportunity.evidence"
				:sources="sources"
				@jump="emit('jump', $event)"
			/>
			<details class="opportunity-context">
				<summary>Ranking factors, benefits and risks</summary>
				<dl class="factor-grid">
					<div
						v-for="name in FACTOR_NAMES"
						:key="name"
					>
						<dt>{{ name }}</dt>
						<dd>
							{{ opportunity.factors[name].value ?? 'Unknown' }} ·
							{{
								claimStateLabel(opportunity.factors[name].state)
							}}
							<p
								v-if="opportunity.factors[name].inference"
								class="quiet fine"
							>
								Inference:
								{{ opportunity.factors[name].inference }}
							</p>
							<EvidenceLinks
								:references="opportunity.factors[name].evidence"
								:sources="sources"
								compact
								@jump="emit('jump', $event)"
							/>
						</dd>
					</div>
				</dl>
				<dl class="factor-grid">
					<div
						v-for="(title, key) in categories"
						:key="key"
					>
						<dt>{{ title }}</dt>
						<dd>
							<ul v-if="opportunity[key].length">
								<li
									v-for="(description, index) in opportunity[
										key
									]"
									:key="index"
								>
									{{ description }}
								</li>
							</ul>
							<template v-else>None recorded</template>
						</dd>
					</div>
				</dl>
			</details>
			<section
				class="savings"
				aria-label="Savings assumptions"
			>
				<div class="panel-header">
					<div>
						<h3>Estimated savings</h3>
						<p class="quiet fine">
							Monthly occurrences × minutes saved ÷ 60
						</p>
					</div>
					<strong class="savings-value">{{
						opportunity.hoursSavedPerMonth === null ?
							'Not yet estimated'
						:	`${formatHours.format(opportunity.hoursSavedPerMonth)} hours / month`
					}}</strong>
				</div>
				<div class="estimates">
					<AssumptionEditor
						v-for="(label, key) in assumptionLabels"
						:key="key"
						ref="estimates"
						:label="label"
						:assumption="opportunity.assumptions[key]"
						:sources="sources"
						:disabled="disabled"
						:save="(value) => saveAssumption(key, value)"
						@jump="emit('jump', $event)"
					/>
				</div>
			</section>
			<RunControls
				operation="proposal"
				:fixture-available="session.origin === 'hotel-demo'"
				:repeat="!!proposal"
				:disabled="disabled || !canPropose"
				@run="(mode, consent) => run(mode, consent, selectedId)"
			/>
			<p
				v-if="!canPropose"
				class="quiet fine"
			>
				Refresh discovery before generating a proposal.
			</p>
		</div>
		<div
			v-if="proposal"
			:key="proposal.plan.id"
			class="proposal-content"
		>
			<p
				v-if="!opportunity"
				class="pill attention"
			>
				The opportunity is no longer part of discovery. This draft is
				retained for review only.
			</p>
			<p
				v-if="proposal.mode === 'fixture'"
				class="fixture-tag"
			>
				Fixture demo — not live AI
			</p>
			<p
				v-else
				class="pill"
			>
				Live provider output
			</p>
			<PlanComparison
				:current="session.workflow"
				:proposed="proposal.graph"
				:sources="sources"
				@jump="emit('jump', $event)"
			/>
			<PlanEditor
				ref="editor"
				:plan="proposal.plan"
				:stale="blocked"
				:disabled="disabled"
				:save="(patch) => savePlan(selectedId, patch)"
				:download="() => download(selectedId)"
			/>
		</div>
	</section>
</template>

<style scoped>
	.opportunities {
		container-type: inline-size;
	}
	.ranked {
		list-style: none;
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
	}
	.ranked-choice {
		width: 100%;
		display: flex;
		gap: 0.7rem;
		text-align: left;
		background: var(--paper);
		color: var(--pine);
		border: 1px solid var(--line);
		border-radius: 0.38rem;
		padding: 0.58rem;
	}
	.ranked-choice[aria-pressed='true'] {
		background: var(--soft);
		border-color: var(--pine);
	}
	.ranked-choice:hover {
		border-color: var(--pine);
	}
	.ranked-choice small {
		color: var(--muted);
		display: block;
	}
	.rank-number {
		color: var(--pine);
		font-size: 0.79rem;
		font-weight: 700;
		align-self: center;
	}
	.opportunity-detail,
	.proposal-content,
	.orphans {
		margin-top: 0.9rem;
		border-top: 1px solid var(--line);
		padding-top: 0.85rem;
	}
	.opportunity-detail h3 {
		margin: 0 0 0.45rem;
	}
	.opportunity-detail > p {
		margin: 0.4rem 0;
	}
	.opportunity-context {
		margin: 0.75rem 0;
	}
	.factor-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
		margin: 0.6rem 0;
	}
	.factor-grid div {
		background: var(--paper);
		border-radius: 0.3rem;
		padding: 0.4rem;
	}
	.factor-grid dt {
		font-weight: 700;
		text-transform: capitalize;
	}
	.factor-grid dd {
		margin: 0.15rem 0 0;
	}
	.factor-grid ul {
		margin: 0;
		padding-left: 1.15rem;
	}
	.savings {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		padding: 0.7rem;
		margin-bottom: 0.75rem;
	}
	.savings-value {
		color: var(--pine);
		font-size: 1rem;
	}
	.estimates {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	@container (max-width: 31rem) {
		.estimates,
		.factor-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
