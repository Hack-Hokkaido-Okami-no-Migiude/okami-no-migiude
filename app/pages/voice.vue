<template>
	<div
		class="page-shell voice-page"
		:lang="locale"
	>
		<header class="page-shell__header voice-page__header">
			<p class="eyebrow">{{ strings.eyebrow }}</p>
			<div
				class="d-flex align-items-center justify-content-between flex-wrap gap-2"
			>
				<h1 class="mb-0">{{ strings.title }}</h1>
				<p
					v-if="phase === 'live'"
					class="badge text-bg-primary mb-0 voice-page__badge"
				>
					<span
						class="material-symbols-outlined"
						aria-hidden="true"
						>graphic_eq</span
					>
					<span>{{ strings.liveBadge }}</span>
				</p>
			</div>
		</header>

		<section
			v-if="phase === 'checking'"
			class="panel voice-page__section"
			aria-busy="true"
		>
			<p class="mb-0">{{ strings.loading }}</p>
		</section>

		<section
			v-else-if="phase === 'signed-out'"
			class="panel voice-page__section"
		>
			<h2
				id="voice-signin-heading"
				tabindex="-1"
			>
				{{ strings.title }}
			</h2>
			<p>{{ strings.signOutNotice.message }}</p>
			<NuxtLink
				class="button-primary"
				to="/sign-in?next=/voice"
			>
				{{ strings.signOutNotice.signIn }}
			</NuxtLink>
		</section>

		<section
			v-else-if="phase === 'staff'"
			class="panel voice-page__section"
		>
			<h2
				id="voice-staff-heading"
				tabindex="-1"
			>
				{{ strings.staffNotice.title }}
			</h2>
			<p class="mb-0">{{ strings.staffNotice.message }}</p>
		</section>

		<section
			v-else-if="phase === 'unavailable'"
			class="panel voice-page__section"
		>
			<h2
				id="voice-unavailable-heading"
				tabindex="-1"
			>
				{{ strings.unavailable.title }}
			</h2>
			<p class="mb-0">{{ strings.unavailable.body }}</p>
		</section>

		<section
			v-else-if="phase === 'intro'"
			class="panel voice-page__section"
		>
			<div class="voice-page__intro-head">
				<img
					class="voice-page__mascot"
					src="/branding/shima-enaga.svg"
					alt=""
					width="88"
					height="88"
				/>
				<div>
					<h2
						id="voice-intro-heading"
						tabindex="-1"
					>
						{{ strings.intro.heading }}
					</h2>
					<p>{{ strings.intro.lead }}</p>
				</div>
			</div>
			<h3>{{ strings.intro.detailsHeading }}</h3>
			<p>{{ strings.intro.details }}</p>
			<dl class="voice-page__details">
				<div>
					<dt>{{ strings.intro.businessLabel }}</dt>
					<dd>{{ profileValue('businessName') }}</dd>
				</div>
				<div>
					<dt>{{ strings.intro.locationLabel }}</dt>
					<dd>{{ profileValue('municipality') }}</dd>
				</div>
			</dl>
			<h3>{{ strings.intro.micHeading }}</h3>
			<p>{{ strings.intro.mic }}</p>
			<h3>{{ strings.intro.processingHeading }}</h3>
			<p>{{ strings.intro.processing }}</p>
			<h3>{{ strings.intro.researchHeading }}</h3>
			<p>{{ strings.intro.research }}</p>
			<button
				class="button-primary"
				type="button"
				@click="phase = 'consent'"
			>
				{{ strings.intro.nextButton }}
			</button>
			<template v-if="previousTranscript !== null">
				<h3>{{ strings.intro.previousHeading }}</h3>
				<pre class="voice-page__previous">{{ previousTranscript }}</pre>
			</template>
		</section>

		<section
			v-else-if="phase === 'consent'"
			class="voice-page__section"
		>
			<p
				v-if="failureText !== null"
				class="notice"
				role="alert"
			>
				{{ failureText }}
			</p>
			<p
				v-else-if="errorText !== null"
				class="notice"
				role="alert"
			>
				{{ errorText }}
			</p>
			<InterviewConsentGate
				:strings="strings"
				:starting="starting"
				@change="onConsentChange"
				@confirm="onConsentConfirm"
			/>
		</section>

		<template v-else-if="phase === 'live' || phase === 'ended'">
			<p
				v-if="phase === 'live'"
				class="notice"
				role="status"
			>
				{{
					chat.callState.value === 'connecting' ?
						strings.status.connecting
					:	strings.status.inCall
				}}
			</p>
			<p
				v-else
				class="notice"
				role="status"
			>
				{{ strings.status.ended }}
			</p>

			<p
				v-if="failureText !== null"
				class="notice"
				role="alert"
			>
				{{ failureText }}
			</p>

			<div class="voice-page__columns">
				<div class="voice-page__left">
					<section
						class="panel voice-page__research"
						aria-labelledby="voice-research-heading"
					>
						<h2 id="voice-research-heading">
							{{ strings.research.heading }}
						</h2>
						<template v-if="research !== null">
							<p class="mb-1">
								{{ researchText }}
							</p>
							<template v-if="research.cases.length > 0">
								<h3>{{ strings.research.casesHeading }}</h3>
								<ul class="voice-page__cases">
									<li
										v-for="(item, index) in research.cases"
										:key="index"
									>
										{{
											item.title
											|| `${item.company} — ${item.solution}`
										}}
									</li>
								</ul>
							</template>
						</template>
					</section>
					<div
						v-if="phase === 'live'"
						class="voice-page__actions"
					>
						<button
							class="button-primary"
							type="button"
							:disabled="
								ending || chat.callState.value !== 'in-call'
							"
							@click="onEnd"
						>
							{{
								ending ?
									strings.status.ending
								:	strings.controls.end
							}}
						</button>
						<button
							class="button-secondary"
							type="button"
							:disabled="chat.callState.value !== 'in-call'"
							@click="onSwitchLanguage"
						>
							{{ switchLabel }}
						</button>
					</div>
					<div
						v-else
						class="voice-page__actions"
					>
						<NuxtLink
							to="/"
							class="button-primary"
						>
							{{ strings.endedActions.backHome }}
						</NuxtLink>
						<button
							class="button-secondary"
							type="button"
							@click="onRestart"
						>
							{{ strings.endedActions.startAgain }}
						</button>
					</div>
				</div>

				<div class="voice-page__right">
					<section
						class="panel voice-page__transcript-panel"
						aria-labelledby="voice-transcript-heading"
					>
						<h2 id="voice-transcript-heading">
							{{ strings.transcript.heading }}
						</h2>
						<p
							v-if="phase === 'ended'"
							class="voice-page__saved"
							role="status"
						>
							{{
								savedTranscript === 'saved' ?
									strings.status.saved
								:	strings.status.saving
							}}
						</p>
						<p
							v-if="chat.turns.value.length === 0"
							class="voice-page__empty"
						>
							{{ strings.transcript.empty }}
						</p>
						<ol
							class="voice-page__transcript"
							role="log"
							aria-labelledby="voice-transcript-heading"
						>
							<li
								v-for="(turn, index) in chat.turns.value"
								:key="index"
								class="voice-page__turn"
								:class="`voice-page__turn--${turn.role}`"
							>
								<strong class="voice-page__turn-label">{{
									turn.role === 'agent' ?
										strings.transcript.agentLabel
									:	strings.transcript.userLabel
								}}</strong>
								<p class="voice-page__turn-message">
									{{ turn.message }}
								</p>
							</li>
						</ol>
					</section>
				</div>
			</div>
		</template>
	</div>
</template>

<script lang="ts" setup>
	import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import InterviewConsentGate from '../components/interview/InterviewConsentGate.vue';
	import { useVoiceChat } from '../composables/useVoiceChat';
	import type { SessionUser } from '../../shared/types/domain.ts';
	import {
		emptyConsents,
		allConsentsGiven,
	} from '../utils/interview-consent.ts';
	import type { ConsentsState } from '../utils/interview-consent.ts';
	import type {
		VoiceConfigResponse,
		VoiceCurrentResponse,
		VoiceSessionStartResponse,
		VoiceSessionStatus,
	} from '#shared/types/voice';
	import { voiceStrings } from '../locales/voice.ts';

	const { locale } = useAppLocale();
	const { user, refreshSession } = useOwnerSession();
	const strings = computed(() => voiceStrings[locale.value]);

	useHead({ title: () => strings.value.pageTitle });

	type VoicePhase =
		| 'checking'
		| 'signed-out'
		| 'staff'
		| 'unavailable'
		| 'intro'
		| 'consent'
		| 'live'
		| 'ended';

	const phase = ref<VoicePhase>('checking');
	const consents = ref<ConsentsState>(emptyConsents());
	const starting = ref(false);
	const ending = ref(false);
	const savedTranscript = ref<'pending' | 'saved' | null>(null);
	const research = ref<VoiceSessionStatus['research'] | null>(null);
	const previousTranscript = ref<string | null>(null);
	const errorNotice = ref<string | null>(null);
	const chat = useVoiceChat();

	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollGeneration = 0;

	function profileValue(key: 'businessName' | 'municipality'): string {
		const sessionUser = user.value as SessionUser | null;
		if (sessionUser === null || sessionUser.role !== 'owner') {
			return '';
		}
		return sessionUser.profile[key];
	}

	const failureText = computed(() => {
		const failure = chat.failure.value;
		if (failure === null) {
			return null;
		}
		return strings.value.failures[failure];
	});

	const errorText = computed(() => errorNotice.value);

	const switchLabel = computed(() =>
		locale.value === 'ja' ?
			strings.value.controls.switchToEnglish
		:	strings.value.controls.switchToJapanese,
	);

	const researchText = computed(() => {
		const state = research.value;
		if (state === null) {
			return strings.value.research.queued;
		}
		if (state.status === 'completed') {
			const count = state.cases.length;
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
		return state.started ?
				strings.value.research.started
			:	strings.value.research.queued;
	});

	onMounted(async () => {
		await refreshSession();
		const sessionUser = user.value as SessionUser | null;
		if (sessionUser === null) {
			phase.value = 'signed-out';
			return;
		}
		if (sessionUser.role !== 'owner') {
			phase.value = 'staff';
			return;
		}
		let available = false;
		try {
			const config =
				await $fetch<VoiceConfigResponse>('/api/voice/config');
			available = config.available === true;
		} catch {
			available = false;
		}
		if (!available) {
			phase.value = 'unavailable';
			return;
		}
		await loadPrevious();
		phase.value = 'intro';
	});

	onBeforeUnmount(() => {
		stopPolling();
		if (chat.callState.value === 'in-call') {
			void chat.end();
		}
	});

	async function loadPrevious() {
		try {
			const current = await $fetch<VoiceCurrentResponse>(
				'/api/voice/sessions/current',
			);
			if (current.session?.transcriptRecorded) {
				previousTranscript.value = current.session.transcript;
			}
		} catch {
			// The previous transcript is optional context only.
		}
	}

	function onConsentChange(state: ConsentsState) {
		consents.value = state;
	}

	async function onConsentConfirm() {
		if (starting.value || !allConsentsGiven(consents.value)) {
			return;
		}
		starting.value = true;
		errorNotice.value = null;
		chat.clearFailure();
		try {
			const created = await $fetch<VoiceSessionStartResponse>(
				'/api/voice/sessions',
				{ method: 'POST', body: { consent: true } },
			);
			const current = await $fetch<VoiceCurrentResponse>(
				'/api/voice/sessions/current',
			);
			const ok = await chat.start({
				conversationToken: created.conversationToken,
				language: locale.value,
				businessContext: current.session?.research.business ?? null,
			});
			if (!ok) {
				return;
			}
			savedTranscript.value = 'pending';
			research.value = current.session?.research ?? null;
			phase.value = 'live';
			startPolling();
		} catch (error) {
			const failure = error as {
				statusCode?: number;
				data?: { error?: string };
			};
			if (failure?.statusCode === 503) {
				phase.value = 'unavailable';
				return;
			}
			if (failure?.data?.error === 'upstream') {
				errorNotice.value = strings.value.errors.upstream;
			} else if (failure?.data?.error === 'validation') {
				errorNotice.value = strings.value.errors.validation;
			} else {
				errorNotice.value = strings.value.errors.network;
			}
		} finally {
			starting.value = false;
		}
	}

	function startPolling() {
		const id = ++pollGeneration;
		const tick = async () => {
			if (id !== pollGeneration) {
				return;
			}
			try {
				const current = await $fetch<VoiceCurrentResponse>(
					'/api/voice/sessions/current',
				);
				if (id !== pollGeneration || current.session === null) {
					return;
				}
				research.value = current.session.research;
				chat.onSessionUpdate(current.session);
				if (
					current.session.transcriptRecorded
					&& savedTranscript.value !== 'saved'
				) {
					savedTranscript.value = 'saved';
					stopPolling();
					return;
				}
			} catch {
				// A brief network interruption should not stop the poll loop.
			}
			if (id === pollGeneration) {
				pollTimer = setTimeout(tick, 2500);
			}
		};
		void tick();
	}

	function stopPolling() {
		pollGeneration += 1;
		if (pollTimer !== null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	async function onEnd() {
		if (ending.value) {
			return;
		}
		ending.value = true;
		await chat.end();
		ending.value = false;
	}

	function onSwitchLanguage() {
		const message =
			locale.value === 'ja' ?
				strings.value.controls.switchMessageEn
			:	strings.value.controls.switchMessageJa;
		chat.switchLanguage(message);
	}

	function onRestart() {
		stopPolling();
		savedTranscript.value = null;
		research.value = null;
		chat.clearFailure();
		void loadPrevious().then(() => {
			phase.value = 'intro';
		});
	}

	// The call can end on its own (agent hang-up, connection drop).
	watch(chat.callState, (state) => {
		if (state === 'ended' && phase.value === 'live') {
			ending.value = false;
			phase.value = 'ended';
		}
	});
</script>

<style lang="scss" scoped>
	.voice-page__header {
		margin-bottom: 1.5rem;
	}

	.voice-page__section {
		margin-bottom: 1.5rem;
	}

	.voice-page__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.75rem;

		.material-symbols-outlined {
			font-size: 1.1rem;
		}
	}

	.voice-page__intro-head {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.voice-page__mascot {
		flex: 0 0 auto;
	}

	.voice-page__details {
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

	.voice-page__previous {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding: 1rem;
		border: 1px solid var(--bs-border-color);
		border-radius: 0.5rem;
		font-size: 0.9rem;
		margin-bottom: 0;
	}

	.voice-page__columns {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;

		@media (min-width: 992px) {
			grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
			align-items: start;
		}
	}

	.voice-page__left,
	.voice-page__right {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.voice-page__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.voice-page__cases {
		margin-bottom: 0;
		overflow-wrap: anywhere;
	}

	.voice-page__saved {
		font-size: 0.9rem;
		opacity: 0.85;
	}

	.voice-page__empty {
		font-size: 0.9rem;
		opacity: 0.85;
	}

	.voice-page__transcript {
		display: grid;
		gap: 0.75rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.voice-page__turn {
		overflow-wrap: anywhere;
	}

	.voice-page__turn-label {
		display: block;
		font-size: 0.8125rem;
		margin-block-end: 0.2rem;
	}

	.voice-page__turn--agent {
		padding: 0.85rem 1rem;
		border: 1px solid var(--bs-border-color);
		border-radius: 0.65rem;

		.voice-page__turn-label {
			color: var(--bs-primary);
		}
	}

	.voice-page__turn--user {
		margin-inline-start: clamp(0.75rem, 4vw, 2rem);
		padding-inline-start: 0.75rem;
		border-inline-start: 2px solid var(--bs-border-color);
		font-size: 0.9375rem;
		opacity: 0.9;

		.voice-page__turn-message {
			white-space: pre-wrap;
		}
	}

	.voice-page__turn-message {
		margin: 0;
		white-space: pre-wrap;
	}

	h2[tabindex='-1'],
	h1 {
		outline: none;
	}
</style>
