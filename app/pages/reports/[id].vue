<!-- Private owner report page (also readable by staff): loads the report via
     the read API, auto-polls while pending, renders the decision-ready
     structured view parsed safely from the Markdown content, keeps the real
     auth-gated Markdown download, and offers the owner-only consultation
     request. All copy is localized; no raw HTML is ever rendered. -->
<template>
	<div
		class="page-shell"
		data-page="report"
	>
		<div
			v-if="state === 'loading'"
			class="panel report-state"
		>
			<p class="eyebrow">
				{{ copy.eyebrow }}
			</p>
			<p class="report-state__text">
				<span
					class="spinner-border spinner-border-sm report-state__spinner"
					role="status"
					aria-hidden="true"
				></span>
				{{ copy.loading }}
			</p>
		</div>

		<div
			v-else-if="state === 'not_found'"
			class="panel report-state"
		>
			<p class="eyebrow">
				{{ copy.eyebrow }}
			</p>
			<h1 class="report-state__title">
				{{ copy.notFoundTitle }}
			</h1>
			<p class="notice">
				{{ copy.notFoundBody }}
			</p>
			<NuxtLink
				to="/"
				class="button-secondary"
			>
				{{ copy.backHome }}
			</NuxtLink>
		</div>

		<div
			v-else-if="state === 'unauthorized'"
			class="panel report-state"
		>
			<p class="eyebrow">
				{{ copy.eyebrow }}
			</p>
			<h1 class="report-state__title">
				{{ copy.unauthorizedTitle }}
			</h1>
			<p class="notice">
				{{ copy.unauthorizedBody }}
			</p>
			<a
				:href="signInHref"
				class="button-primary"
			>
				{{ copy.goSignIn }}
			</a>
		</div>

		<div
			v-else-if="state === 'forbidden'"
			class="panel report-state"
		>
			<p class="eyebrow">
				{{ copy.eyebrow }}
			</p>
			<h1 class="report-state__title">
				{{ copy.forbiddenTitle }}
			</h1>
			<p class="notice">
				{{ copy.forbiddenBody }}
			</p>
			<NuxtLink
				to="/"
				class="button-secondary"
			>
				{{ copy.backHome }}
			</NuxtLink>
		</div>

		<div
			v-else-if="state === 'error'"
			class="panel report-state"
		>
			<p class="eyebrow">
				{{ copy.eyebrow }}
			</p>
			<h1 class="report-state__title">
				{{ copy.loadErrorTitle }}
			</h1>
			<p class="notice">
				{{ copy.loadErrorBody }}
			</p>
			<button
				type="button"
				class="button-secondary"
				@click="reload()"
			>
				{{ copy.refresh }}
			</button>
		</div>

		<template v-else-if="report">
			<ReportMetaHeader
				:report="report"
				:structured="structured"
				:copy="copy"
				:is-staff="isStaff"
			/>

			<div
				v-if="state === 'pending'"
				class="notice report-state"
			>
				<p class="report-state__text">
					<span
						class="spinner-border spinner-border-sm report-state__spinner"
						role="status"
						aria-hidden="true"
					></span>
					<strong>{{ copy.pendingTitle }}</strong>
				</p>
				<p class="report-state__text">
					{{ copy.pendingBody }}
				</p>
				<button
					type="button"
					class="button-secondary"
					:disabled="reloading"
					@click="reload()"
				>
					{{ copy.refresh }}
				</button>
			</div>

			<div
				v-else-if="state === 'failed'"
				class="notice report-state"
			>
				<p class="report-state__text">
					<strong>{{ copy.failedTitle }}</strong>
				</p>
				<p class="report-state__text">
					{{ copy.failedBody }}
				</p>
				<p
					v-if="report.failureReason"
					class="report-state__reason"
				>
					<span class="eyebrow">{{ copy.failureReasonLabel }}</span>
					{{ report.failureReason }}
				</p>
				<button
					type="button"
					class="button-secondary"
					:disabled="reloading"
					@click="reload()"
				>
					{{ copy.refresh }}
				</button>
			</div>

			<template v-else-if="state === 'ready'">
				<template v-if="structured">
					<section
						v-if="structured.summary.length > 0"
						class="panel"
					>
						<p class="eyebrow">
							{{ copy.sections.summary }}
						</p>
						<ul class="report-summary">
							<li
								v-for="(line, index) in structured.summary"
								:key="index"
							>
								{{ line }}
							</li>
						</ul>
					</section>

					<ReportFlowDiagram
						v-if="structured.flow"
						:flow="structured.flow"
						:title="copy.sections.flow"
						:current-label="copy.sections.currentFlow"
						:improved-label="copy.sections.improvedFlow"
						:example-label="structured.flow.exampleLabel"
					/>

					<section
						v-if="structured.bottlenecks.length > 0"
						class="panel"
					>
						<p class="eyebrow">
							{{ copy.sections.bottlenecks }}
						</p>
						<ul class="report-summary">
							<li
								v-for="(line, index) in structured.bottlenecks"
								:key="index"
							>
								{{ line }}
							</li>
						</ul>
					</section>

					<div
						v-if="hasEstimates"
						class="row g-3 report-estimates"
					>
						<div
							v-if="structured.timeSavings"
							class="col-12 col-lg-4"
						>
							<ReportEstimateCard
								:title="copy.sections.timeSavings"
								:items="structured.timeSavings.items"
								:estimate-label="
									structured.timeSavings.estimateLabel
								"
							/>
						</div>
						<div
							v-if="structured.workload"
							class="col-12 col-lg-4"
						>
							<ReportEstimateCard
								:title="copy.sections.workload"
								:items="structured.workload.items"
								:estimate-label="
									structured.workload.estimateLabel
								"
							/>
						</div>
						<div
							v-if="structured.costs"
							class="col-12 col-lg-4"
						>
							<ReportEstimateCard
								:title="copy.sections.costs"
								:items="structured.costs.items"
								:estimate-label="structured.costs.estimateLabel"
							/>
						</div>
					</div>

					<section
						v-if="structured.buildVsBuy.length > 0"
						class="panel"
					>
						<p class="eyebrow">
							{{ copy.sections.buildVsBuy }}
						</p>
						<ul class="report-summary">
							<li
								v-for="(line, index) in structured.buildVsBuy"
								:key="index"
							>
								{{ line }}
							</li>
						</ul>
					</section>

					<section
						v-if="structured.topics.length > 0"
						class="report-topics"
					>
						<p class="eyebrow">
							{{ copy.sections.topics }}
						</p>
						<div class="row g-3">
							<div
								v-for="(topic, index) in structured.topics"
								:key="index"
								class="col-12 col-lg-6"
							>
								<ReportTopicCard
									:topic="topic"
									:observation-label="copy.topicObservation"
									:action-label="copy.topicAction"
								/>
							</div>
						</div>
					</section>

					<section
						v-if="structured.nextSteps.length > 0"
						class="panel"
					>
						<p class="eyebrow">
							{{ copy.sections.nextSteps }}
						</p>
						<ol class="report-steps">
							<li
								v-for="(step, index) in structured.nextSteps"
								:key="index"
							>
								{{ step }}
							</li>
						</ol>
					</section>
				</template>

				<section class="panel report-actions">
					<p
						v-if="canDownload"
						class="report-actions__row"
					>
						<a
							:href="downloadHref"
							class="button-secondary"
						>
							{{ copy.download }}
						</a>
					</p>
					<p
						v-else
						class="report-actions__row report-actions__hint"
					>
						{{ copy.downloadUnavailable }}
					</p>
					<p class="report-actions__row">
						<button
							type="button"
							class="button-secondary"
							@click="showSource = !showSource"
						>
							{{ showSource ? copy.hideSource : copy.showSource }}
						</button>
					</p>
					<ReportConsultationCard
						v-if="isOwner"
						class="report-actions__consultation"
						:copy="copy.consultation"
						:requested-at-label="consultationRequestedAtLabel"
						:requesting="requestingConsultation"
						:notice="consultationNotice"
						@request="requestConsultation"
					/>
				</section>

				<section
					v-if="showSource"
					class="panel"
				>
					<p class="eyebrow">
						{{ copy.sourceHeading }}
					</p>
					<ReportMarkdownView :content="report.content ?? ''" />
				</section>

				<p
					v-if="structured?.footnote"
					class="report-footnote"
				>
					{{ structured.footnote }}
				</p>
			</template>
		</template>
	</div>
</template>

<script lang="ts" setup>
	import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
	import type { Report } from '#shared/types/domain';
	import type { ReportResponse } from '#shared/types/api';
	import type { ReportContent } from '#shared/types/report-content';
	import {
		formatReportDateTime,
		parseReportContent,
	} from '~/utils/report-content';
	import { reportCopy } from '~/locales/report';
	import { useReportShell } from '~/utils/report-shell';
	import ReportMetaHeader from '~/components/report/ReportMetaHeader.vue';
	import ReportFlowDiagram from '~/components/report/ReportFlowDiagram.vue';
	import ReportEstimateCard from '~/components/report/ReportEstimateCard.vue';
	import ReportTopicCard from '~/components/report/ReportTopicCard.vue';
	import ReportMarkdownView from '~/components/report/ReportMarkdownView.vue';
	import ReportConsultationCard from '~/components/report/ReportConsultationCard.vue';

	type PageState =
		| 'loading'
		| 'pending'
		| 'ready'
		| 'failed'
		| 'not_found'
		| 'unauthorized'
		| 'forbidden'
		| 'error';

	const POLL_INTERVAL_MS = 2000;
	const POLL_MAX_MS = 10 * 60 * 1000;

	const route = useRoute();
	const shell = useReportShell();

	const reportId = computed(() => String(route.params.id ?? ''));
	const copy = computed(() => reportCopy(shell.locale.value));

	const report = ref<Report | null>(null);
	const state = ref<PageState>('loading');
	const reloading = ref(false);
	const showSource = ref(false);
	const requestingConsultation = ref(false);
	const consultationNotice = ref<string | null>(null);

	const structured = computed<ReportContent | null>(() =>
		report.value?.content ? parseReportContent(report.value.content) : null,
	);

	const isOwner = computed(() => shell.user.value?.role === 'owner');
	const isStaff = computed(() => shell.user.value?.role === 'staff');

	const hasEstimates = computed(() => {
		const content = structured.value;
		return Boolean(
			content
			&& (content.timeSavings || content.workload || content.costs),
		);
	});

	const canDownload = computed(
		() => state.value === 'ready' && report.value?.status === 'ready',
	);

	const downloadHref = computed(
		() => `/api/reports/${reportId.value}/download`,
	);

	const signInHref = computed(
		() => `/sign-in?next=/reports/${reportId.value}`,
	);

	const consultationRequestedAtLabel = computed(() => {
		const iso = report.value?.consultationRequestedAt;
		return iso ? formatReportDateTime(iso, shell.locale.value) : null;
	});

	onBeforeUnmount(stopPolling);

	onMounted(async () => {
		if (!shell.user.value) {
			await shell.refreshSession();
		}
		if (!shell.user.value) {
			await redirectToSignIn();
			return;
		}
		await loadReport();
	});

	async function redirectToSignIn() {
		await navigateTo({
			path: '/sign-in',
			query: { next: `/reports/${reportId.value}` },
		});
	}

	async function reload() {
		reloading.value = true;
		try {
			await loadReport({ silent: true });
		} finally {
			reloading.value = false;
		}
	}

	async function loadReport(options: { silent?: boolean } = {}) {
		if (!options.silent && !report.value) {
			state.value = 'loading';
		}
		try {
			const data = await $fetch<ReportResponse>(
				`/api/reports/${reportId.value}`,
				{ headers: { 'cache-control': 'no-cache' } },
			);
			report.value = data.report;
			state.value = data.report.status;
			if (data.report.status === 'pending') {
				schedulePoll();
			} else {
				stopPolling();
			}
		} catch (error) {
			stopPolling();
			const status = fetchStatus(error);
			if (status === 401) {
				shell.clearSession();
				await redirectToSignIn();
				return;
			}
			if (status === 403) {
				state.value = 'forbidden';
			} else if (status === 404) {
				state.value = 'not_found';
			} else {
				state.value = 'error';
			}
		}
	}

	// Pending auto-poll: refresh the read API on an interval until the worker
	// marks the report ready (or failed), bounded so a stuck report stops
	// polling after 10 minutes and the owner can still reload manually.
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollDeadline = 0;

	function stopPolling() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		pollDeadline = 0;
	}

	function schedulePoll() {
		if (!pollDeadline) {
			pollDeadline = Date.now() + POLL_MAX_MS;
		}
		if (Date.now() >= pollDeadline) {
			return;
		}
		pollTimer = setTimeout(() => {
			pollTimer = null;
			void loadReport({ silent: true });
		}, POLL_INTERVAL_MS);
	}

	async function requestConsultation() {
		if (!isOwner.value || !report.value || requestingConsultation.value) {
			return;
		}
		requestingConsultation.value = true;
		consultationNotice.value = null;
		try {
			const data = await $fetch<ReportResponse>(
				`/api/reports/${reportId.value}/consultation`,
				{ method: 'POST' },
			);
			report.value = data.report;
		} catch (error) {
			const code = fetchErrorCode(error);
			if (fetchStatus(error) === 401) {
				shell.clearSession();
				await redirectToSignIn();
				return;
			}
			if (code === 'already_requested') {
				consultationNotice.value =
					copy.value.consultation.alreadyNotice;
				await loadReport({ silent: true });
			} else if (code === 'not_ready') {
				consultationNotice.value =
					copy.value.consultation.notReadyNotice;
			} else if (code === 'forbidden') {
				consultationNotice.value = copy.value.forbiddenBody;
			} else {
				consultationNotice.value = copy.value.consultation.errorNotice;
			}
		} finally {
			requestingConsultation.value = false;
		}
	}

	function fetchStatus(error: unknown): number {
		const direct = (error as { status?: number } | null)?.status;
		if (typeof direct === 'number') {
			return direct;
		}
		const response = (error as { response?: { status?: number } } | null)
			?.response;
		return typeof response?.status === 'number' ? response.status : 0;
	}

	function fetchErrorCode(error: unknown): string {
		const data = (error as { data?: { error?: unknown } } | null)?.data;
		const nested = (
			error as { response?: { data?: { error?: unknown } } } | null
		)?.response?.data;
		const code = data?.error ?? nested?.error;
		return typeof code === 'string' ? code : '';
	}
</script>

<style lang="scss" scoped>
	/* Layout only — shared primitives (.page-shell, .panel, .notice, .eyebrow,
   .button-*) are styled by the app shell; this page only adds report-owned
   classes so the two never fight over the same properties. */

	.report-state {
		&__title {
			font-size: 1.4rem;
			font-weight: 700;
			margin: 0 0 0.5rem;
		}

		&__text {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin: 0 0 0.5rem;
		}

		&__spinner {
			flex: none;
		}

		&__reason {
			font-size: 0.9rem;
			opacity: 0.85;
			margin: 0 0 0.75rem;

			.eyebrow {
				display: block;
				margin-bottom: 0.125rem;
			}
		}
	}

	.report-summary {
		margin: 0;
		padding-left: 1.1rem;

		li + li {
			margin-top: 0.375rem;
		}
	}

	.report-steps {
		margin: 0;
		padding-left: 1.25rem;

		li + li {
			margin-top: 0.375rem;
		}
	}

	.report-estimates {
		margin-bottom: 1rem;
	}

	.report-topics {
		margin-bottom: 1rem;

		.eyebrow {
			margin: 0.25rem 0 0.75rem;
		}
	}

	.report-actions {
		&__row {
			margin: 0 0 0.5rem;

			a,
			button {
				text-decoration: none;
			}
		}

		&__hint {
			font-size: 0.9rem;
			opacity: 0.8;
		}

		&__consultation {
			margin-top: 1rem;
		}
	}

	.report-footnote {
		font-size: 0.85rem;
		opacity: 0.75;
		margin: 1.5rem 0 0;
		white-space: pre-wrap;
	}
</style>
