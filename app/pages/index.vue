<script setup lang="ts">
	import type { EvidenceRef } from '#shared/p0/types';
	import FollowUpPanel from '../components/workbench/FollowUpPanel.vue';
	import OpportunitiesPanel from '../components/workbench/OpportunitiesPanel.vue';
	import RunControls from '../components/workbench/RunControls.vue';
	import SessionRail from '../components/workbench/SessionRail.vue';
	import TranscriptPane from '../components/workbench/TranscriptPane.vue';
	import WorkflowReview from '../components/workbench/WorkflowReview.vue';
	import { evidenceSources } from '../composables/workbenchDescriptors';
	import { useDraftProtection } from '../composables/useDraftProtection';
	import { useWorkbench } from '../composables/useWorkbench';

	const { confirmLeaving, hasUnsavedEdits } = useDraftProtection();
	const workbench = useWorkbench(hasUnsavedEdits);
	const {
		session,
		clients,
		sessions,
		clientId,
		busy,
		problem,
		notice,
		conflict,
		writeDisabled,
	} = workbench;

	const sections = {
		discovery: 'Discovery',
		questions: 'Follow-up questions',
		plans: 'Opportunities & plans',
	};
	const section = ref<keyof typeof sections>('discovery');
	const selectedEvidence = ref<EvidenceRef | null>(null);
	const jumpCount = ref(0);
	const sources = computed(() =>
		session.value ? evidenceSources(session.value) : [],
	);
	const answers = computed(() =>
		sources.value.filter((source) =>
			session.value?.questions.some(
				(question) => question.answer?.id === source.id,
			),
		),
	);
	const activeClient = computed(() =>
		clients.value.find((client) => client.id === session.value?.clientId),
	);
	const questionCount = computed(
		() =>
			session.value?.questions.filter(
				(question) => question.status === 'open',
			).length ?? 0,
	);
	const stage = computed(() => {
		if (!session.value?.transcript) {
			return 'Awaiting transcript';
		}
		if (!session.value.discovery) {
			return 'Ready for discovery';
		}
		return session.value.discovery.stale ?
				'Discovery needs refresh'
			:	'Discovery current';
	});

	useHead({ title: 'Sapporo Workflow Workbench', htmlAttrs: { lang: 'en' } });
	onMounted(workbench.initialize);
	watch(
		() => session.value?.id,
		() => {
			section.value = 'discovery';
			selectedEvidence.value = null;
		},
	);

	function jumpToSource(reference: EvidenceRef) {
		selectedEvidence.value = reference;
		jumpCount.value += 1;
	}

	async function createInterview(title: string) {
		return confirmLeaving() && workbench.createSession(title);
	}
</script>

<template>
	<div class="workbench">
		<SessionRail
			:clients="clients"
			:sessions="sessions"
			:client-id="clientId"
			:session="session"
			:busy="!!busy"
			:create-client="workbench.createClient"
			:create-session="createInterview"
			@browse="workbench.browse"
			@open="
				(owner, id) =>
					confirmLeaving() && workbench.openSession(owner, id)
			"
			@demo="
				(session?.origin === 'hotel-demo' || confirmLeaving())
				&& workbench.openDemo()
			"
		/>
		<div class="workspace">
			<header
				v-if="session"
				class="interview-heading"
			>
				<div class="interview-title">
					<p class="eyebrow">
						Client engagement
						<template v-if="activeClient"
							>/ {{ activeClient.name }}</template
						>
					</p>
					<h1>{{ session.title }}</h1>
					<div class="actions">
						<span
							class="pill"
							:class="{ attention: session.discovery?.stale }"
							>{{ stage }}</span
						>
						<span
							v-if="
								session.origin === 'hotel-demo'
								|| session.discovery?.mode === 'fixture'
							"
							class="fixture-tag"
							>Fixture demo — not live AI</span
						>
						<span
							v-if="session.discovery?.mode === 'live'"
							class="pill"
							>Live provider output</span
						>
						<span class="quiet fine mono"
							>Rev {{ session.rev }}</span
						>
					</div>
				</div>
				<RunControls
					:key="session.id"
					operation="discovery"
					:fixture-available="session.origin === 'hotel-demo'"
					:repeat="!!session.discovery"
					:disabled="
						writeDisabled || !session.transcript?.segments.length
					"
					@run="workbench.run"
				/>
			</header>

			<div
				v-if="problem || conflict"
				class="request-error"
			>
				<p role="alert">
					{{
						problem
						|| 'Load the latest revision before applying more changes.'
					}}
				</p>
				<button
					v-if="conflict || !session"
					class="button"
					type="button"
					:disabled="!!busy"
					@click="workbench.reload"
				>
					{{
						conflict ?
							'Load latest revision'
						:	'Retry loading workbench'
					}}
				</button>
			</div>
			<p
				class="activity"
				role="status"
				aria-atomic="true"
			>
				{{ busy || notice }}
			</p>

			<div
				v-if="session"
				:key="session.id"
			>
				<nav
					class="section-nav"
					aria-label="Interview views"
				>
					<button
						v-for="(label, key) in sections"
						:key="key"
						type="button"
						:aria-pressed="key === section"
						:aria-controls="`view-${key}`"
						@click="section = key"
					>
						{{ label }}
						<span
							v-if="key === 'questions' && questionCount"
							class="pill"
							>{{ questionCount }}</span
						>
					</button>
				</nav>
				<div
					class="work-grid"
					:inert="Boolean(busy)"
					:aria-busy="Boolean(busy)"
				>
					<TranscriptPane
						:segments="session.transcript?.segments ?? []"
						:has-transcript="!!session.transcript"
						:answers="answers"
						:selected="selectedEvidence"
						:jump-count="jumpCount"
						:disabled="writeDisabled"
						:save="workbench.saveTranscript"
						:remove="workbench.deleteTranscript"
					/>
					<div
						v-show="section === 'discovery'"
						id="view-discovery"
						class="discovery-grid"
					>
						<WorkflowReview
							:session="session"
							:sources="sources"
							:disabled="writeDisabled"
							:save="workbench.saveFinding"
							@jump="jumpToSource"
						/>
					</div>
					<div
						v-show="section === 'questions'"
						id="view-questions"
					>
						<FollowUpPanel
							:questions="session.questions"
							:steps="session.workflow.steps"
							:sources="sources"
							:disabled="writeDisabled"
							:analyzed="!!session.discovery"
							:save="workbench.saveAnswer"
							@jump="jumpToSource"
						/>
					</div>
					<div
						v-show="section === 'plans'"
						id="view-plans"
					>
						<OpportunitiesPanel
							:session="session"
							:sources="sources"
							:disabled="writeDisabled"
							:save-assumptions="workbench.saveAssumptions"
							:save-plan="workbench.savePlan"
							:download="workbench.downloadPlan"
							:run="workbench.run"
							@jump="jumpToSource"
						/>
					</div>
				</div>
			</div>

			<section
				v-else
				class="launch"
				aria-labelledby="start-heading"
			>
				<div class="launch-copy">
					<p class="eyebrow">
						Consultant workbench / <span lang="ja">札幌</span>
					</p>
					<h1 id="start-heading">Choose an interview to begin</h1>
					<p>
						Start with a saved client interview, create a new one,
						or open the fictional Sapporo hotel from the client
						panel.
					</p>
				</div>
				<ol
					class="work-stages"
					aria-label="How the workbench is organized"
				>
					<li>
						<span class="eyebrow">01 / Source</span
						><strong>Record the interview</strong>
						<p>
							Paste the original wording with optional speakers
							and timestamps.
						</p>
					</li>
					<li>
						<span class="eyebrow">02 / Discovery</span
						><strong>Review the current workflow</strong>
						<p>
							Trace steps and handoffs to evidence; record answers
							to unresolved questions.
						</p>
					</li>
					<li>
						<span class="eyebrow">03 / Planning</span
						><strong>Compare proposed changes</strong>
						<p>
							Rank opportunities, estimate savings and prepare a
							reviewed implementation plan.
						</p>
					</li>
				</ol>
			</section>
		</div>
	</div>
</template>

<style scoped lang="scss">
	@use '../styles/workbench-page.scss';
</style>
