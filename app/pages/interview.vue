<template>
	<div
		class="page-shell interview-page"
		:lang="locale"
	>
		<header class="page-shell__header interview-page__header">
			<p class="eyebrow">{{ strings.eyebrow }}</p>
			<div
				class="d-flex align-items-center justify-content-between flex-wrap gap-2"
			>
				<h1 class="mb-0">{{ strings.title }}</h1>
				<InterviewDemoBadge
					v-if="showDemoBadge"
					:label="strings.demoBadge"
				/>
			</div>
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
			<h3>{{ strings.intro.privacyHeading }}</h3>
			<p>{{ strings.intro.privacy }}</p>
			<h3>{{ strings.intro.demoHeading }}</h3>
			<p>{{ strings.intro.demo }}</p>
			<button
				class="button-primary"
				type="button"
				@click="flow.beginConsent()"
			>
				{{ strings.intro.nextButton }}
			</button>
		</section>

		<section
			v-else-if="flow.phase.value === 'consent'"
			class="interview-page__section"
		>
			<InterviewConsentGate
				:strings="strings"
				:starting="consentStarting"
				@change="onConsentChange"
				@confirm="onConsentConfirm"
			/>
		</section>

		<template v-else-if="isWorkingPhase">
			<div class="interview-page__status d-flex flex-wrap gap-3">
				<InterviewTimer
					:remaining-text="timer.remainingText.value"
					:expired="timer.passed.value"
					:announcement="timer.announcement.value"
					:strings="strings"
				/>
			</div>

			<p
				v-if="flow.error.value !== null"
				class="notice"
				role="alert"
			>
				{{ errorText }}
			</p>
			<p
				v-else-if="flow.draftRestored.value"
				class="notice"
			>
				{{ strings.activeNotice.resumed }}
			</p>
			<p
				v-else
				class="notice"
			>
				{{ strings.activeNotice.entered }}
			</p>

			<div class="interview-page__columns">
				<div class="interview-page__left">
					<InterviewScriptPlayer
						v-if="scriptData !== null"
						:strings="strings"
						:script="scriptData"
						:locale="locale"
						:speech="speech"
						:initial-index="revealedScriptCount"
						@append="onScriptAppend"
						@append-all="onScriptAppendAll"
						@reset="flow.clearTranscript()"
					/>
					<section
						v-else
						class="panel interview-page__other-business"
						aria-labelledby="interview-other-heading"
					>
						<h2 id="interview-other-heading">
							{{ strings.otherBusiness.heading }}
						</h2>
						<p>{{ strings.otherBusiness.body }}</p>
						<h3>{{ strings.otherBusiness.topicsHeading }}</h3>
						<ul>
							<li
								v-for="(topic, index) in strings.otherBusiness
									.topics"
								:key="index"
							>
								{{ topic }}
							</li>
						</ul>
					</section>

					<InterviewCaptureControls
						:capture="capture"
						:strings="strings"
						:deadline-ms="deadlineMs"
						:disabled="flow.phase.value !== 'active'"
					/>
				</div>

				<div class="interview-page__right">
					<InterviewTranscriptEditor
						v-model="transcriptModel"
						:strings="strings"
						:restored="flow.draftRestored.value"
						:readonly="flow.phase.value === 'submitting'"
						:show-validation="showValidation"
					/>

					<section
						class="panel interview-page__submit"
						aria-labelledby="interview-submit-heading"
					>
						<h2 id="interview-submit-heading">
							{{ strings.transcript.submitHeading }}
						</h2>
						<p class="interview-page__submit-hint">
							{{ strings.transcript.submitHint }}
						</p>
						<button
							class="button-primary"
							type="button"
							:disabled="
								flow.phase.value !== 'active'
								|| !flow.transcriptCheck.value.ok
							"
							@click="onSubmit"
						>
							{{
								flow.phase.value === 'submitting' ?
									strings.transcript.submitting
								:	strings.transcript.submitButton
							}}
						</button>
					</section>
				</div>
			</div>
		</template>

		<section
			v-else-if="flow.phase.value === 'expired'"
			class="panel interview-page__section"
		>
			<h2
				id="interview-expired-heading"
				tabindex="-1"
			>
				{{ strings.expired.heading }}
			</h2>
			<p>{{ strings.expired.body }}</p>
			<button
				class="button-primary"
				type="button"
				@click="onRestart"
			>
				{{ strings.expired.restartButton }}
			</button>
		</section>

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
	import { computed, nextTick, onMounted, ref, watch } from 'vue';
	import {
		createDraftStore,
		type DraftStore,
	} from '../utils/interview-draft.ts';
	import {
		createInterviewClient,
		type InterviewHttp,
	} from '../utils/interview-api.ts';
	import {
		interviewScript,
		type InterviewScriptData,
	} from '../locales/interview-script.ts';
	import type { ConsentsState } from '../utils/interview-consent.ts';
	import InterviewCaptureControls from '../components/interview/InterviewCaptureControls.vue';
	import InterviewConsentGate from '../components/interview/InterviewConsentGate.vue';
	import InterviewDemoBadge from '../components/interview/InterviewDemoBadge.vue';
	import InterviewScriptPlayer from '../components/interview/InterviewScriptPlayer.vue';
	import InterviewTimer from '../components/interview/InterviewTimer.vue';
	import InterviewTranscriptEditor from '../components/interview/InterviewTranscriptEditor.vue';
	import type { SessionUser } from '../../shared/types/domain.ts';
	import { createInterviewFlow } from '../composables/useInterviewFlow.ts';
	import { interviewStrings } from '../locales/interview.ts';
	import { parseDeadlineMs } from '../utils/interview-deadline.ts';
	import { renderScriptTranscript } from '../utils/interview-transcript.ts';
	import { useInterviewCapture } from '../composables/useInterviewCapture.ts';
	import { useInterviewSpeech } from '../composables/useInterviewSpeech.ts';
	import { useInterviewTimer } from '../composables/useInterviewTimer.ts';

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

	function browserDraftStore(): DraftStore | null {
		if (typeof window === 'undefined') {
			return null;
		}
		try {
			return createDraftStore(window.sessionStorage);
		} catch {
			return null;
		}
	}

	const client = createInterviewClient(
		interviewHttp as unknown as InterviewHttp,
	);
	const flow = createInterviewFlow({
		client,
		draft: browserDraftStore(),
	});
	const timer = useInterviewTimer(flow.deadlineAt);
	const capture = useInterviewCapture();
	const speech = useInterviewSpeech();

	const showValidation = ref(false);
	const consentStarting = ref(false);

	// Hard cut: the timer flips first; capture, speech and the flow are
	// stopped/rejected from here.
	watch(timer.passed, (passed) => {
		if (!passed) {
			return;
		}
		capture.stop('deadline');
		speech.cancel();
		flow.markDeadlinePassed();
	});

	// Keep each announcement on screen long enough for screen readers.
	watch(timer.announcement, (key) => {
		if (key === null || typeof window === 'undefined') {
			return;
		}
		window.setTimeout(() => {
			timer.clearAnnouncement();
		}, 1000);
	});

	const isWorkingPhase = computed(
		() =>
			flow.phase.value === 'active' || flow.phase.value === 'submitting',
	);

	const deadlineMs = computed(() => {
		const value = flow.deadlineAt.value;
		if (value === null) {
			return null;
		}
		try {
			return parseDeadlineMs(value);
		} catch {
			return null;
		}
	});

	const showDemoBadge = computed(() => isWorkingPhase.value);

	const scriptData = computed<InterviewScriptData | null>(() => {
		const sessionUser = user.value as SessionUser | null;
		if (sessionUser === null || sessionUser.role !== 'owner') {
			return null;
		}
		return sessionUser.profile.businessType === 'accommodation' ?
				interviewScript[locale.value]
			:	null;
	});

	/** How many script lines are already inside the transcript (prefix match). */
	const revealedScriptCount = computed(() => {
		const data = scriptData.value;
		if (data === null) {
			return 0;
		}
		const rendered = data.lines.map((line) =>
			renderScriptTranscript([line], data.speakerLabels),
		);
		const current = flow.transcript.value;
		let count = 0;
		for (const line of rendered) {
			if (!current.includes(line)) {
				break;
			}
			count += 1;
		}
		return count;
	});

	const transcriptModel = computed({
		get: () => flow.transcript.value,
		set: (value: string) => flow.onTranscriptInput(value),
	});

	const errorText = computed(() => {
		const code = flow.error.value;
		if (code === null) {
			return '';
		}
		return strings.value.errors[code];
	});

	function onConsentChange(state: ConsentsState) {
		flow.consents.value = state;
	}

	async function onConsentConfirm() {
		if (consentStarting.value) {
			return;
		}
		consentStarting.value = true;
		try {
			await flow.start();
		} finally {
			consentStarting.value = false;
		}
	}

	function onScriptAppend(text: string) {
		flow.appendTranscript(text);
	}

	function onScriptAppendAll(text: string) {
		flow.appendTranscript(text);
	}

	async function onSubmit() {
		showValidation.value = true;
		if (!flow.transcriptCheck.value.ok) {
			return;
		}
		if (capture.recording.value) {
			capture.stop('user');
		}
		await flow.submit();
	}

	async function onRestart() {
		await flow.restart();
	}

	async function onRetry() {
		await flow.init();
	}

	onMounted(async () => {
		await refreshSession();
		await flow.notifySession((user.value as SessionUser | null) ?? null);
	});

	// Focus management: move focus to each phase's heading on transition.
	watch(
		() => flow.phase.value,
		async (phase) => {
			const targets: Partial<Record<string, string>> = {
				consent: 'interview-consent-heading',
				active: 'interview-transcript-heading',
				submitted: 'interview-submitted-heading',
				expired: 'interview-expired-heading',
				unavailable: 'interview-unavailable-heading',
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

	.interview-page__status {
		margin-bottom: 1rem;
	}

	.interview-page__columns {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;

		@media (min-width: 992px) {
			grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
			align-items: start;
		}
	}

	.interview-page__left,
	.interview-page__right {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.interview-page__other-business ul {
		margin-bottom: 0;
	}

	.interview-page__submit-hint {
		font-size: 0.9rem;
		opacity: 0.85;
	}

	h2[tabindex='-1'],
	h1 {
		outline: none;
	}
</style>
