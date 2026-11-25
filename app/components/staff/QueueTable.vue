<script lang="ts" setup>
	import type { StaffReportSummary } from '#shared/types/domain';
	import { staffStrings } from '~/locales/staff';

	defineProps<{ reports: StaffReportSummary[] }>();

	const { locale } = useAppLocale();

	const t = computed(() => staffStrings[locale.value]);

	function localeTag(): string {
		return locale.value === 'ja' ? 'ja-JP' : 'en-US';
	}

	// Timestamps are ISO 8601 UTC on the wire; rendered in the UI locale.
	function formatWhen(iso: string): string {
		return new Date(iso).toLocaleString(localeTag(), {
			dateStyle: 'medium',
			timeStyle: 'short',
		});
	}
</script>

<template>
	<div class="table-scroll">
		<table class="queue-table">
			<thead>
				<tr>
					<th scope="col">{{ t.columns.business }}</th>
					<th scope="col">{{ t.columns.owner }}</th>
					<th scope="col">{{ t.columns.contact }}</th>
					<th scope="col">{{ t.columns.status }}</th>
					<th scope="col">{{ t.columns.consultation }}</th>
					<th scope="col">{{ t.columns.createdAt }}</th>
					<th scope="col">
						<span class="visually-hidden">
							{{ t.columns.actions }}
						</span>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="report in reports"
					:key="report.id"
				>
					<td>
						<NuxtLink
							:to="`/reports/${report.id}`"
							class="business-link"
						>
							{{ report.businessName }}
						</NuxtLink>
						<span class="locale-tag">
							{{ report.locale === 'ja' ? '日本語' : 'English' }}
						</span>
					</td>
					<td>{{ report.ownerName }}</td>
					<td class="cell-muted">{{ report.ownerEmail }}</td>
					<td><StaffStatusBadge :status="report.status" /></td>
					<td>
						<template v-if="report.consultationRequestedAt">
							<span class="consult-pill">
								{{ t.consultation.requested }}
							</span>
							<span class="consult-when">
								{{ formatWhen(report.consultationRequestedAt) }}
							</span>
						</template>
						<span
							v-else
							class="cell-muted"
						>
							{{ t.consultation.none }}
						</span>
					</td>
					<td class="cell-muted">
						{{ formatWhen(report.createdAt) }}
					</td>
					<td class="cell-actions">
						<NuxtLink
							:to="`/reports/${report.id}`"
							class="button-secondary view-link"
						>
							{{ t.viewReport }}
						</NuxtLink>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style lang="scss" scoped>
	.table-scroll {
		overflow-x: auto;
	}

	.queue-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95rem;
	}

	.queue-table th {
		text-align: left;
		padding: 0.6rem 0.9rem;
		border-bottom: 2px solid var(--line-strong);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.queue-table td {
		padding: 0.8rem 0.9rem;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}

	.queue-table tbody tr:last-child td {
		border-bottom: 0;
	}

	.business-link {
		font-weight: 600;
	}

	.locale-tag {
		display: block;
		font-size: 0.78rem;
		color: var(--ink-soft);
		margin-block-start: 0.15rem;
	}

	.cell-muted {
		color: var(--ink-soft);
		font-size: 0.88rem;
	}

	.consult-pill {
		display: inline-block;
		border: 1px solid rgba(176, 74, 33, 0.35);
		border-radius: 999px;
		background: rgba(176, 74, 33, 0.12);
		color: var(--rust-deep);
		padding: 0.15rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.consult-when {
		display: block;
		font-size: 0.8rem;
		color: var(--ink-soft);
		margin-block-start: 0.2rem;
		white-space: nowrap;
	}

	.cell-actions {
		text-align: right;
		white-space: nowrap;
	}

	.view-link {
		min-height: 2.2rem;
		padding: 0.3rem 1rem;
		font-size: 0.88rem;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
