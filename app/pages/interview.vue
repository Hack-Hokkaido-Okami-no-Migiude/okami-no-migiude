<template>
	<div
		class="page-shell interview-page"
		:lang="locale"
		:data-interview-state="flow.phase.value"
	>
		<header class="page-shell__header interview-page__header">
			<p class="eyebrow">{{ strings.eyebrow }}</p>
			<h1 class="mb-0">{{ strings.title }}</h1>
		</header>

		<section
			v-if="flow.phase.value === 'checking'"
			class="panel interview-page__section"
			aria-busy="true"
		>
			<p class="mb-0">{{ strings.loading }}</p>
		</section>

		<section
			v-else-if="flow.phase.value === 'signed-out'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-signin-heading"
				tabindex="-1"
			>
				{{ strings.title }}
			</h2>
			<p>{{ strings.signOutNotice.message }}</p>
			<NuxtLink
				class="button-primary"
				to="/sign-in?next=/interview"
			>
				{{ strings.signOutNotice.signIn }}
			</NuxtLink>
		</section>

		<section
			v-else-if="flow.phase.value === 'staff'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-staff-heading"
				tabindex="-1"
			>
				{{ strings.staffNotice.title }}
			</h2>
			<p class="mb-0">{{ strings.staffNotice.message }}</p>
		</section>

		<!-- Honest deployment state: the agent is not configured, so nothing
		     is called and no substitute interview surface is offered. -->
		<section
			v-else-if="flow.phase.value === 'agent-unavailable'"
			class="panel interview-page__section"
			data-testid="interview-agent-unavailable"
		>
			<h2
				id="interview-agent-unavailable-heading"
				tabindex="-1"
			>
				{{ strings.agentUnavailable.title }}
			</h2>
			<p class="mb-0">{{ strings.agentUnavailable.body }}</p>
		</section>

		<section
			v-else-if="flow.phase.value === 'unavailable'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-unavailable-heading"
				tabindex="-1"
			>
				{{ strings.unavailable.title }}
			</h2>
			<p>{{ strings.unavailable.body }}</p>
			<button
				class="button-primary"
				type="button"
				@click="onRetry"
			>
				{{ strings.unavailable.retryButton }}
			</button>
		</section>

		<section
			v-else-if="flow.phase.value === 'demo-active'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-demo-active-heading"
				tabindex="-1"
			>
				{{ strings.demoActive.title }}
			</h2>
			<p class="mb-0">{{ strings.demoActive.body }}</p>
		</section>

		<section
			v-else-if="flow.phase.value === 'intro'"
			class="panel interview-page__section"
		>
			<div class="interview-page__intro-head">
				<img
					class="interview-page__mascot"
					src="/branding/shima-enaga.svg"
					alt=""
					width="88"
					height="88"
				/>
				<div>
					<h2
						id="interview-intro-heading"
						tabindex="-1"
					>
						{{ strings.intro.heading }}
					</h2>
					<p>{{ strings.intro.lead }}</p>
				</div>
			</div>
			<h3>{{ strings.intro.stepsHeading }}</h3>
			<ol>
				<li
					v-for="(step, index) in strings.intro.steps"
					:key="index"
				>
					{{ step }}
				</li>
			</ol>
			<h3>{{ strings.intro.businessHeading }}</h3>
			<p>{{ strings.intro.businessNote }}</p>
			<dl class="interview-page__details">
				<div>
					<dt>{{ strings.intro.businessLabel }}</dt>
					<dd>{{ profileValue('businessName') }}</dd>
				</div>
				<div>
					<dt>{{ strings.intro.locationLabel }}</dt>
					<dd>{{ profileValue('municipality') }}</dd>
				</div>
			</dl>
			<h3>{{ strings.intro.processingHeading }}</h3>
			<p>{{ strings.intro.processing }}</p>
			<h3>{{ strings.intro.researchHeading }}</h3>
			<p>{{ strings.intro.research }}</p>
			<button
				class="button-primary"
				type="button"
				@click="flow.beginConsent()"
			>
				{{ strings.intro.nextButton }}
			</button>
		</section>

		<!-- The consent gate comes before the conversation: the WebRTC session
		     cannot be minted or started, and no agent surface is offered or
		     loaded, until all three consents are given. -->
		<section
			v-else-if="flow.phase.value === 'consent'"
			class="interview-page__section"
		>
			<p
				v-if="flow.error.value !== null"
				class="notice"
				role="alert"
			>
				{{ errorText }}
			</p>
			<InterviewConsentGate
				:strings="strings"
				:starting="consentStarting"
				@change="onConsentChange"
				@confirm="onConsentConfirm"
			/>
		</section>

		<template
			v-else-if="
				flow.phase.value === 'live' || flow.phase.value === 'ended'
			"
		>
			<p
				class="notice"
				role="status"
			>
				{{ liveNotice }}
			</p>
			<p
				v-if="flow.error.value !== null"
				class="notice"
				role="alert"
			>
				{{ errorText }}
			</p>
			<p
				v-if="callFailureText !== null"
				class="notice"
				role="alert"
			>
				{{ callFailureText }}
			</p>

			<div class="interview-page__columns">
				<div class="interview-page__left">
					<section
						class="panel interview-page__research"
						aria-labelledby="interview-research-heading"
					>
						<h2 id="interview-research-heading">
							{{ strings.research.heading }}
						</h2>
						<p class="mb-1">{{ researchText }}</p>
						<template v-if="researchCases.length > 0">
							<h3>{{ strings.research.caseLabel }}</h3>
							<ul class="interview-page__cases">
								<li
									v-for="(item, index) in researchCases"
									:key="index"
								>
									{{
										item.title
										|| `${item.company} — ${item.solution}`
									}}
								</li>
							</ul>
						</template>
					</section>
					<div class="interview-page__actions">
						<button
							v-if="flow.phase.value === 'live'"
							class="button-primary"
							type="button"
							:disabled="ending"
							@click="onEnd"
						>
							{{
								ending ?
									strings.live.ending
								:	strings.live.endButton
							}}
						</button>
						<template v-else>
							<NuxtLink
								to="/"
								class="button-primary"
							>
								{{ strings.live.backHome }}
							</NuxtLink>
							<button
								class="button-secondary"
								type="button"
								@click="onRestart"
							>
								{{ strings.live.checkAgain }}
							</button>
						</template>
					</div>
				</div>
			</div>
		</template>

		<section
			v-else-if="flow.phase.value === 'submitted'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-submitted-heading"
				tabindex="-1"
			>
				{{ strings.submitted.heading }}
			</h2>
			<p>{{ strings.submitted.body }}</p>
			<p
				v-if="assessmentText !== null"
				class="interview-page__assessment"
				role="status"
			>
				{{ assessmentText }}
			</p>
			<NuxtLink
				v-if="flow.reportId.value !== null"
				class="button-primary"
				:to="`/reports/${flow.reportId.value}`"
			>
				{{ strings.submitted.reportLink }}
			</NuxtLink>
		</section>
	</div>
</template>

<script lang="ts" setup>
	import {
		computed,
		nextTick,
		onBeforeUnmount,
		onMounted,
		ref,
		watch,
	} from 'vue';
	import {
		createInterviewClient,
		type ConversationGrant,
		type InterviewHttp,
	} from '../utils/interview-api.ts';
	import type { ConsentsState } from '../utils/interview-consent.ts';
	import InterviewConsentGate from '../components/interview/InterviewConsentGate.vue';
	import type { SessionUser } from '../../shared/types/domain.ts';
	import { useInterviewConversation } from '../composables/useInterviewConversation.ts';
	import { createInterviewFlow } from '../composables/useInterviewFlow.ts';
	import { interviewStrings } from '../locales/interview.ts';

	const { locale } = useAppLocale();
	const { user, refreshSession } = useOwnerSession();

	const strings = computed(() => interviewStrings[locale.value]);

	useHead({ title: () => strings.value.pageTitle });

	async function interviewHttp(
		path: string,
		init: { method: 'GET' | 'POST'; body?: unknown },
	) {
		try {
			const json = await $fetch<unknown>(path, {
				method: init.method,
				body: init.body,
			});
			return { status: 200, json };
		} catch (error) {
			const failure = error as {
				statusCode?: number;
				data?: unknown;
			};
			if (typeof failure?.statusCode === 'number') {
				return {
					status: failure.statusCode,
					json: failure.data ?? null,
				};
			}
			return { status: 0, json: null, networkError: true };
		}
	}

	const client = createInterviewClient(
		interviewHttp as unknown as InterviewHttp,
	);
	const flow = createInterviewFlow({ client });

	// The live conversation runs from the server-minted token the flow
	// machine fetches on entering the live phase; the controller owns the
	// WebRTC session (connect state, failures, end).
	const chat = useInterviewConversation();

	const consentStarting = ref(false);
	const ending = ref(false);

	function profileValue(key: 'businessName' | 'municipality'): string {
		const sessionUser = user.value as SessionUser | null;
		if (sessionUser === null || sessionUser.role !== 'owner') {
			return '';
		}
		return sessionUser.profile[key];
	}

	const errorText = computed(() => {
		const code = flow.error.value;
		if (code === null) {
			return '';
		}
		return strings.value.errors[code];
	});

	const callFailureText = computed(() => {
		const failure = chat.failure.value;
		if (failure === null) {
			return null;
		}
		return strings.value.callFailures[failure];
	});

	const resumed = ref(false);

	const liveNotice = computed(() => {
		if (flow.phase.value === 'ended') {
			return strings.value.live.ended;
		}
		if (chat.callState.value === 'connecting') {
			return strings.value.live.entering;
		}
		if (resumed.value) {
			return strings.value.live.resumed;
		}
		return strings.value.live.inCall;
	});

	const researchCases = computed(() => flow.research.value?.cases ?? []);

	const researchText = computed(() => {
		const state = flow.research.value;
		if (state === null) {
			return strings.value.research.queued;
		}
		if (state.status === 'completed') {
			const count = state.cases?.length ?? 0;
			return count === 1 ?
					strings.value.research.completedOne
				:	strings.value.research.completed.replace(
						'{count}',
						String(count),
					);
		}
		if (state.status === 'failed') {
			return strings.value.research.failed;
		}
		if (state.status === 'idle') {
			// Never queued: the research stack is not configured here.
			return strings.value.research.notConnected;
		}
		return state.started ?
				strings.value.research.started
			:	strings.value.research.queued;
	});

	const assessmentText = computed(() => {
		if (flow.phase.value !== 'submitted') {
			return null;
		}
		const state = flow.assessment.value;
		if (
			state !== null
			&& (state.status === 'failed' || state.status === 'idle')
			&& flow.availability.value?.reportEngineAvailable === false
		) {
			return strings.value.assessment.unavailable;
		}
		if (state?.status === 'failed') {
			return strings.value.assessment.failed;
		}
		if (flow.reportId.value !== null) {
			return null;
		}
		return strings.value.assessment.preparing;
	});

	function onConsentChange(state: ConsentsState) {
		flow.consents.value = state;
	}

	async function onConsentConfirm() {
		if (consentStarting.value) {
			return;
		}
		consentStarting.value = true;
		resumed.value = false;
		chat.clearFailure();
		try {
			await flow.start();
		} finally {
			consentStarting.value = false;
		}
	}

	// A minted grant starts the WebRTC conversation. It arrives only after
	// the consent gate completed (the machine mints on live entry), so the
	// controller here never has to police consent itself.
	watch(
		() => flow.conversation.value,
		(grant: ConversationGrant | null) => {
			if (
				grant === null
				|| chat.callState.value === 'connecting'
				|| chat.callState.value === 'in-call'
			) {
				return;
			}
			void chat.start({
				conversationToken: grant.conversationToken,
				interviewId: flow.interview.value?.id ?? '',
				language: locale.value,
				businessName: profileValue('businessName'),
				location: profileValue('municipality'),
			});
		},
	);

	// The conversation can end on its own (agent hang-up, dropped link):
	// leave the call view and keep monitoring for the webhook outcome. Once
	// it is connected, hand off research that already completed while the
	// session was still connecting (a resumed interview can arrive that way).
	watch(
		() => chat.callState.value,
		(state) => {
			if (state === 'in-call') {
				chat.handOffResearch(flow.research.value);
				return;
			}
			if (state === 'ended' && flow.phase.value === 'live') {
				flow.notifyCallEnded();
			}
		},
	);

	// The researched cases reach the agent once they exist (the composable
	// hands them off exactly once, and only while the call is live).
	watch(
		() => flow.research.value,
		(research) => {
			chat.handOffResearch(research);
		},
	);

	async function onEnd() {
		if (ending.value) {
			return;
		}
		ending.value = true;
		// endSession ends the WebRTC conversation; the transcript arrives
		// via the server-to-server webhook and the poll picks up the
		// outcome.
		await chat.end();
		flow.notifyCallEnded();
		ending.value = false;
	}

	async function onRestart() {
		resumed.value = true;
		chat.clearFailure();
		await flow.restart();
	}

	async function onRetry() {
		await flow.init();
	}

	// Poll while a conversation may still land: during the call, after the
	// page's end action, and while the report is being prepared. The webhook
	// (server-to-server) carries the transcript, so leaving the page is safe.
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollGeneration = 0;

	function stopPolling() {
		pollGeneration += 1;
		if (pollTimer !== null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function startPolling() {
		stopPolling();
		const id = ++pollGeneration;
		const tick = async () => {
			if (id !== pollGeneration) {
				return;
			}
			await flow.refresh();
			if (id === pollGeneration) {
				pollTimer = setTimeout(tick, 2500);
			}
		};
		void tick();
	}

	watch(
		() => flow.phase.value,
		(phase) => {
			if (
				phase === 'live'
				|| phase === 'ended'
				|| phase === 'submitted'
			) {
				startPolling();
				return;
			}
			stopPolling();
		},
	);

	onBeforeUnmount(() => {
		stopPolling();
		// Leaving the page mid-call ends the session so the transcript is
		// finalized (the webhook delivers it either way).
		void chat.end();
	});

	onMounted(async () => {
		await refreshSession();
		await flow.notifySession((user.value as SessionUser | null) ?? null);
		if (flow.phase.value === 'live') {
			resumed.value = true;
		}
	});

	// Focus management: move focus to each phase's heading on transition.
	watch(
		() => flow.phase.value,
		async (phase) => {
			const targets: Partial<Record<string, string>> = {
				consent: 'interview-consent-heading',
				submitted: 'interview-submitted-heading',
				unavailable: 'interview-unavailable-heading',
				'agent-unavailable': 'interview-agent-unavailable-heading',
				'demo-active': 'interview-demo-active-heading',
				'signed-out': 'interview-signin-heading',
				staff: 'interview-staff-heading',
				intro: 'interview-intro-heading',
			};
			const targetId = targets[phase];
			if (targetId === undefined || typeof document === 'undefined') {
				return;
			}
			await nextTick();
			document.getElementById(targetId)?.focus();
		},
	);
</script>

<style lang="scss" scoped>
	.interview-page__header {
		margin-bottom: 1.5rem;
	}

	.interview-page__section {
		margin-bottom: 1.5rem;
	}

	.interview-page__intro-head {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.interview-page__mascot {
		flex: 0 0 auto;
	}

	.interview-page__details {
		display: grid;
		gap: 0.5rem;

		div {
			display: flex;
			gap: 0.75rem;
		}

		dt {
			flex: 0 0 10rem;
			font-weight: 600;
		}

		dd {
			margin: 0;
			overflow-wrap: anywhere;
		}
	}

	.interview-page__columns {
		display: grid;
		grid-template-columns: 1fr;

		@media (min-width: 992px) {
			grid-template-columns: minmax(0, 5fr);
		}
	}

	.interview-page__left {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.interview-page__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.interview-page__cases {
		margin-bottom: 0;
		overflow-wrap: anywhere;
	}

	.interview-page__assessment {
		font-size: 0.9rem;
		opacity: 0.85;
	}

	h2[tabindex='-1'],
	h1 {
		outline: none;
	}
</style>
