<template>
	<div class="workbench">
		<header class="workbench-header">
			<h1>Sapporo workflow workbench</h1>
			<p
				v-if="session"
				class="fixture-banner"
			>
				Fixture demo — not live AI
			</p>
		</header>

		<p
			v-if="errorMessage"
			class="error-banner"
			role="alert"
		>
			{{ errorText }}
		</p>

		<section
			v-if="!session"
			class="open-panel"
		>
			<p>
				Open the fictional hotel fixture to explore a discovered
				workflow, questions, and proposals.
			</p>
			<button
				type="button"
				:disabled="busy"
				@click="openDemo"
			>
				Open hotel fixture demo
			</button>
		</section>

		<template v-if="session">
			<section class="summary-row">
				<span>{{ session.clientId }} / {{ session.id }}</span>
				<span>rev {{ session.rev }}</span>
				<span v-if="session.discovery">
					discovery: {{ session.discovery.mode
					}}{{ session.discovery.stale ? ' (stale)' : '' }}
				</span>
				<button
					type="button"
					:disabled="busy"
					@click="openDemo"
				>
					Reseed / reopen
				</button>
				<button
					type="button"
					:disabled="busy"
					@click="runAnalyze"
				>
					Run analyze (fixture)
				</button>
			</section>

			<section class="panel">
				<h2>Transcript</h2>
				<ol class="transcript">
					<li
						v-for="segment in transcriptSegments"
						:key="segment.id"
					>
						<span class="item-id">{{ segment.id }}</span>
						<strong v-if="segment.speaker"
							>{{ segment.speaker }}:</strong
						>
						<span>{{ segment.text }}</span>
					</li>
				</ol>
			</section>

			<div class="columns">
				<section class="panel">
					<h2>Graph steps</h2>
					<ul class="item-list">
						<li
							v-for="step in session.workflow.steps"
							:key="step.id"
						>
							<button
								type="button"
								class="select-item"
								:class="{
									selected: selectedStepId === step.id,
								}"
								@click="selectedStepId = step.id"
							>
								<span class="item-id">{{ step.id }}</span>
								{{ step.label.value }}
							</button>
						</li>
					</ul>
					<div
						v-if="selectedStep"
						class="detail"
					>
						<h3>{{ selectedStep.id }}</h3>
						<dl>
							<div
								v-for="field in stepFields(selectedStep)"
								:key="field.name"
							>
								<dt>{{ field.name }}</dt>
								<dd>{{ field.text }}</dd>
							</div>
						</dl>
						<h4>Evidence</h4>
						<ul class="evidence-list">
							<li
								v-for="reference in selectedStep.label.evidence"
								:key="`${reference.sourceId}:${reference.quote}`"
							>
								<span class="item-id">{{
									reference.sourceId
								}}</span>
								<q>{{ reference.quote }}</q>
							</li>
						</ul>
					</div>

					<h2>Edges</h2>
					<ul class="item-list">
						<li
							v-for="edge in session.workflow.edges"
							:key="edge.id"
						>
							<span class="item-id">{{ edge.id }}</span>
							{{ edge.fromStepId }} → {{ edge.toStepId }} ({{
								edge.kind
							}})
						</li>
					</ul>

					<h2>Review notices</h2>
					<ul class="item-list">
						<li
							v-for="(notice, index) in session.reviewNotices"
							:key="`${notice.code}:${index}`"
						>
							<span class="notice-code">{{ notice.code }}</span>
							{{ notice.message }}
						</li>
					</ul>
				</section>

				<section class="panel">
					<h2>Open questions</h2>
					<ul class="item-list">
						<li
							v-for="question in openQuestions"
							:key="question.id"
						>
							<span class="item-id">{{ question.id }}</span>
							[{{ question.factKey }}] {{ question.prompt }}
						</li>
						<li v-if="openQuestions.length === 0">
							No open questions.
						</li>
					</ul>

					<h2>Opportunities</h2>
					<ul class="item-list">
						<li
							v-for="opportunity in session.opportunities"
							:key="opportunity.id"
						>
							<button
								type="button"
								class="select-item"
								:class="{
									selected:
										selectedOpportunityId
										=== opportunity.id,
								}"
								@click="selectedOpportunityId = opportunity.id"
							>
								<span class="item-id">{{
									opportunity.id
								}}</span>
								{{ opportunity.title }}
							</button>
						</li>
					</ul>
					<div
						v-if="selectedOpportunity"
						class="detail"
					>
						<p>
							Estimated savings:
							<strong>{{
								savingsLabel(selectedOpportunity)
							}}</strong>
						</p>
						<button
							type="button"
							:disabled="busy"
							@click="runProposal(selectedOpportunity.id)"
						>
							Create proposal (fixture)
						</button>
					</div>

					<h2>Proposals</h2>
					<ul class="item-list">
						<li
							v-for="proposal in session.proposals"
							:key="proposal.plan.id"
						>
							<span class="item-id">{{
								proposal.opportunityId
							}}</span>
							plan {{ proposal.plan.id }} ({{
								proposal.plan.status
							}}{{ proposal.stale ? ', stale' : '' }})
							<a :href="planUrl(proposal.opportunityId)"
								>Download plan.md</a
							>
						</li>
						<li v-if="session.proposals.length === 0">
							No proposals yet.
						</li>
					</ul>

					<template v-if="selectedProposal">
						<h2>Graph comparison</h2>
						<div class="compare-grid">
							<div>
								<h3>Current</h3>
								<ul class="item-list">
									<li
										v-for="step in session.workflow.steps"
										:key="step.id"
									>
										<span class="item-id">{{
											step.id
										}}</span>
										{{ step.label.value }}
									</li>
								</ul>
							</div>
							<div>
								<h3>Proposed</h3>
								<ul class="item-list">
									<li
										v-for="step in selectedProposal.graph
											.steps"
										:key="step.id"
									>
										<span class="item-id">{{
											step.id
										}}</span>
										{{ step.label }}
									</li>
									<li
										v-for="edge in selectedProposal.graph
											.edges"
										:key="edge.id"
									>
										<span class="item-id">{{
											edge.id
										}}</span>
										{{ edge.fromStepId }} →
										{{ edge.toStepId }}: {{ edge.label }}
									</li>
								</ul>
							</div>
						</div>
					</template>
				</section>
			</div>
		</template>
	</div>
</template>

<script lang="ts" setup>
	import type {
		Opportunity,
		Segment,
		Session,
		Step,
	} from '../../shared/p0/types';

	const STORAGE_KEY = 'p0.hotel-demo.session';

	const session = ref<Session | null>(null);
	const busy = ref(false);
	const errorMessage = ref('');
	const selectedStepId = ref('');
	const selectedOpportunityId = ref('');

	const transcriptSegments = computed<Segment[]>(
		() => session.value?.transcript?.segments ?? [],
	);
	const openQuestions = computed(
		() =>
			session.value?.questions.filter(
				(question) => question.status === 'open',
			) ?? [],
	);
	const selectedStep = computed(() =>
		session.value?.workflow.steps.find(
			(step) => step.id === selectedStepId.value,
		),
	);
	const selectedOpportunity = computed(() =>
		session.value?.opportunities.find(
			(opportunity) => opportunity.id === selectedOpportunityId.value,
		),
	);
	const selectedProposal = computed(() =>
		session.value?.proposals.find(
			(proposal) =>
				proposal.opportunityId === selectedOpportunityId.value,
		),
	);
	const errorText = computed(() =>
		errorMessage.value ? `Request failed: ${errorMessage.value}` : '',
	);

	async function applySession(
		request: () => Promise<Session>,
	): Promise<void> {
		busy.value = true;
		errorMessage.value = '';
		try {
			const next = await request();
			session.value = next;
			selectedStepId.value = next.workflow.steps[0]?.id ?? '';
		} catch (error) {
			errorMessage.value = describeError(error);
		} finally {
			busy.value = false;
		}
	}

	function sessionFrom(response: { _data?: Session }): Session {
		const data = response._data;
		if (!data) {
			throw new Error('Server returned no session data.');
		}
		return data;
	}

	function openDemo(): Promise<void> {
		return applySession(async () => {
			const response = await $fetch.raw<Session>('/api/demo/hotel', {
				method: 'POST',
				body: {},
			});
			const seeded = sessionFrom(response);
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					clientId: seeded.clientId,
					sessionId: seeded.id,
				}),
			);
			return seeded;
		});
	}

	function runAnalyze(): Promise<void> {
		const current = session.value;
		if (!current) {
			return Promise.resolve();
		}
		return applySession(async () => {
			const response = await $fetch<{
				outcome: string;
				session: Session;
			}>(
				`/api/clients/${current.clientId}/sessions/${current.id}/analyze`,
				{
					method: 'POST',
					body: { baseRev: current.rev, mode: 'fixture' },
				},
			);
			return response.session;
		});
	}

	function runProposal(opportunityId: string): Promise<void> {
		const current = session.value;
		if (!current) {
			return Promise.resolve();
		}
		return applySession(async () => {
			const response = await $fetch<{
				outcome: string;
				session: Session;
			}>(
				`/api/clients/${current.clientId}/sessions/${current.id}/opportunities/${opportunityId}/proposal`,
				{
					method: 'POST',
					body: { baseRev: current.rev, mode: 'fixture' },
				},
			);
			return response.session;
		});
	}

	function planUrl(opportunityId: string): string {
		const current = session.value;
		return current ?
				`/api/clients/${current.clientId}/sessions/${current.id}/opportunities/${opportunityId}/plan.md`
			:	'#';
	}

	function stepFields(step: Step): { name: string; text: string }[] {
		return [
			{ name: 'role', value: step.role },
			{ name: 'tool', value: step.tool },
			{ name: 'execution', value: step.execution },
		].map((field) => ({
			name: field.name,
			text:
				field.value.value === null ?
					'unknown'
				:	`${field.value.value} (${field.value.state})`,
		}));
	}

	function savingsLabel(opportunity: Opportunity): string {
		return opportunity.hoursSavedPerMonth === null ?
				'not yet estimated'
			:	`${opportunity.hoursSavedPerMonth} hours per month`;
	}

	function describeError(error: unknown): string {
		const data = (
			error as { data?: { error?: { code?: string; message?: string } } }
		).data;
		if (data?.error) {
			return `${data.error.code}: ${data.error.message}`;
		}
		return 'unexpected error';
	}

	onMounted(async () => {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) {
			return;
		}
		try {
			const { clientId, sessionId } = JSON.parse(stored) as {
				clientId: string;
				sessionId: string;
			};
			await applySession(async () => {
				const response = await $fetch.raw<Session>(
					`/api/clients/${clientId}/sessions/${sessionId}`,
				);
				return sessionFrom(response);
			});
		} catch {
			localStorage.removeItem(STORAGE_KEY);
		}
	});
</script>

<style scoped>
	.workbench {
		max-width: 68rem;
		margin: 0 auto;
		padding: 1.5rem;
		font-family: system-ui, sans-serif;
		color: inherit;
	}
	.workbench-header h1 {
		font-size: 1.4rem;
		margin: 0 0 0.5rem;
	}
	.fixture-banner {
		display: inline-block;
		margin: 0 0 1rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		font-size: 0.85rem;
	}
	.error-banner {
		padding: 0.5rem 0.75rem;
		border: 1px solid #b4232a;
		border-radius: 0.25rem;
		color: #b4232a;
	}
	.open-panel {
		margin: 2rem 0;
	}
	button,
	.select-item {
		font: inherit;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
	}
	.summary-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}
	.panel {
		border: 1px solid currentColor;
		border-radius: 0.35rem;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.panel h2 {
		font-size: 1.05rem;
		margin: 0.5rem 0;
	}
	.columns {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
	}
	.transcript,
	.item-list,
	.evidence-list {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.9rem;
	}
	.transcript strong {
		margin-right: 0.3rem;
	}
	.transcript li {
		margin-bottom: 0.6rem;
	}
	.item-list li,
	.evidence-list li {
		margin-bottom: 0.4rem;
	}
	.item-id,
	.notice-code {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		opacity: 0.75;
		margin-right: 0.4rem;
	}
	.select-item {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		padding: 0.25rem 0.4rem;
	}
	.select-item.selected {
		border-color: currentColor;
	}
	.detail {
		border-top: 1px dashed currentColor;
		margin-top: 0.75rem;
		padding-top: 0.5rem;
	}
	.detail h3,
	.detail h4 {
		margin: 0.4rem 0;
		font-size: 0.95rem;
	}
	.detail dl {
		margin: 0;
	}
	.detail dt {
		font-weight: 600;
		font-size: 0.8rem;
	}
	.detail dd {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}
	.compare-grid {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	}
	.compare-grid h3 {
		margin: 0.3rem 0;
		font-size: 0.95rem;
	}
</style>
