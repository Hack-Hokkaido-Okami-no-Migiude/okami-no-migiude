<script lang="ts" setup>
	import type { StaffReportSummary } from '#shared/types/domain';
	import { staffStrings } from '~/locales/staff';

	const { locale } = useAppLocale();
	const { user, refreshSession } = useOwnerSession();

	const t = computed(() => staffStrings[locale.value]);

	type Phase = 'checking' | 'signedOut' | 'forbidden' | 'ready';

	const phase = ref<Phase>('checking');
	const reports = ref<StaffReportSummary[]>([]);
	const loading = ref(false);
	const loadError = ref(false);
	const lastRefreshedAt = ref<string | null>(null);

	useHead({
		title: computed(() =>
			locale.value === 'ja' ?
				`${t.value.title} | 女将の右腕`
			:	`${t.value.title} | Okami no Migiude`,
		),
	});

	// The layout resolves the session (SSR-aware), so the phase can be fixed
	// from the shared user state before the queue ever loads. SSR therefore
	// renders only the neutral shell states — never report or contact data.
	if (user.value) {
		phase.value = user.value.role === 'staff' ? 'checking' : 'forbidden';
	} else {
		phase.value = 'signedOut';
	}

	/** Loads the staff queue. The list never refreshes on its own (manual). */
	async function loadQueue(): Promise<void> {
		loading.value = true;
		loadError.value = false;
		try {
			const response = await fetch('/api/staff/reports');
			if (response.status === 401) {
				// Session gone mid-use: re-sync the shared mirror and fall back
				// to the matching shell state.
				await refreshSession();
				phase.value =
					!user.value ? 'signedOut'
					: user.value.role !== 'staff' ? 'forbidden'
					: 'checking';
				return;
			}
			if (!response.ok) {
				loadError.value = true;
				return;
			}
			const body = (await response.json()) as {
				reports: StaffReportSummary[];
			};
			reports.value = body.reports;
			lastRefreshedAt.value = new Date().toISOString();
			phase.value = 'ready';
		} catch {
			loadError.value = true;
		} finally {
			loading.value = false;
		}
	}

	onMounted(() => {
		if (phase.value === 'checking') {
			void loadQueue();
		}
	});

	function formatWhen(iso: string): string {
		return new Date(iso).toLocaleString(
			locale.value === 'ja' ? 'ja-JP' : 'en-US',
			{ dateStyle: 'medium', timeStyle: 'short' },
		);
	}
</script>

<template>
	<div class="page-shell">
		<span class="eyebrow">{{ t.eyebrow }}</span>
		<div
			class="d-flex flex-wrap align-items-center justify-content-between gap-3"
		>
			<h1 class="mb-0">{{ t.title }}</h1>
			<div
				v-if="phase === 'ready'"
				class="d-flex gap-2"
			>
				<button
					type="button"
					class="button-secondary"
					:disabled="loading"
					@click="loadQueue"
				>
					<span
						class="material-symbols-outlined"
						aria-hidden="true"
					>
						refresh
					</span>
					{{ t.refresh }}
				</button>
			</div>
		</div>
		<p class="text-secondary mb-0">{{ t.intro }}</p>

		<div
			v-if="phase === 'forbidden'"
			class="panel notice"
		>
			<h2 class="h5 mb-1">{{ t.forbidden.title }}</h2>
			<p class="mb-0">{{ t.forbidden.body }}</p>
		</div>
		<div v-else-if="phase === 'ready'">
			<div class="notice">{{ t.outboxNotice }}</div>
			<div
				v-if="loadError"
				class="panel notice"
			>
				<p class="mb-2">{{ t.loadError }}</p>
				<button
					type="button"
					class="button-secondary"
					:disabled="loading"
					@click="loadQueue"
				>
					{{ t.retry }}
				</button>
			</div>
			<div
				v-else
				class="panel"
			>
				<p
					v-if="loading && reports.length === 0"
					class="mb-0"
				>
					{{ t.loading }}
				</p>
				<p
					v-else-if="reports.length === 0"
					class="mb-0"
				>
					{{ t.empty }}
				</p>
				<StaffQueueTable
					v-else
					:reports="reports"
				/>
			</div>
			<p
				v-if="lastRefreshedAt"
				class="small text-secondary mb-0"
			>
				{{ t.lastRefreshed }}: {{ formatWhen(lastRefreshedAt) }}
			</p>
		</div>
		<div
			v-else-if="phase === 'checking'"
			class="panel"
		>
			<p class="mb-0">{{ t.loading }}</p>
		</div>
		<div
			v-else
			class="panel"
		>
			<StaffSignInPrompt />
		</div>
	</div>
</template>
