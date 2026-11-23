<script setup lang="ts">
	import type { EvidenceRef, Segment } from '#shared/p0/types';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';

	const props = defineProps<{
		segments: Segment[];
		answers: EvidenceSource[];
		selected: EvidenceRef | null;
		jumpCount: number;
	}>();
	const pane = ref<HTMLElement | null>(null);
	const rows = computed(() => [
		...props.segments.map((segment, index) => ({
			...segment,
			label: segment.speaker || 'Speaker not recorded',
			index: String(index + 1).padStart(2, '0'),
		})),
		...props.answers.map((answer) => ({
			...answer,
			index: 'A',
			startMs: null,
			endMs: null,
		})),
	]);

	function stamp(milliseconds: number): string {
		const seconds = Math.floor(milliseconds / 1000);
		const base = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
		return milliseconds % 1000 ?
				`${base}.${String(milliseconds % 1000).padStart(3, '0')}`
			:	base;
	}
	const highlight = computed(() => {
		const reference = props.selected;
		const row = rows.value.find(
			(candidate) =>
				candidate.id === reference?.sourceId
				&& candidate.sourceRev === reference.sourceRev,
		);
		if (!reference || !row) {
			return null;
		}
		const offset = row.text.indexOf(reference.quote);
		if (offset < 0) {
			return null;
		}
		return {
			id: row.id,
			before: row.text.slice(0, offset),
			quote: reference.quote,
			after: row.text.slice(offset + reference.quote.length),
		};
	});

	watch(
		() => props.jumpCount,
		async () => {
			await nextTick();
			const row =
				pane.value?.querySelector<HTMLElement>('[data-highlighted]');
			row?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		},
		{ flush: 'post' },
	);
</script>

<template>
	<div
		ref="pane"
		class="source-reader"
		aria-label="Original source"
	>
		<p
			v-if="!rows.length"
			class="empty"
		>
			No transcript yet. Paste or add source rows to begin.
		</p>
		<ol
			v-else
			class="source-rows"
			aria-label="Transcript and saved answers"
			role="list"
		>
			<li
				v-for="row in rows"
				:id="`source-${row.id}`"
				:key="row.id"
				tabindex="-1"
				:data-highlighted="highlight?.id === row.id ? '' : undefined"
			>
				<div class="source-meta">
					<span class="mono">{{ row.index }}</span><strong>{{
						row.label
					}}</strong>
				</div>
				<p
					v-if="row.startMs !== null || row.endMs !== null"
					class="source-time mono"
				>
					{{ row.startMs === null ? '—' : stamp(row.startMs)
					}}<template v-if="row.endMs !== null"
						>–{{ stamp(row.endMs) }}</template
					>
				</p>
				<p
					class="source-text"
					dir="auto"
				>
					<template v-if="highlight?.id === row.id"
						>{{ highlight.before }}<mark>{{ highlight.quote }}</mark
						>{{ highlight.after }}</template
					><template v-else>{{ row.text }}</template>
				</p>
			</li>
		</ol>
	</div>
</template>

<style scoped>
	.source-reader {
		max-height: 36rem;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.source-rows {
		padding: 0 0.3rem 0 0;
		margin: 0;
		list-style: none;
	}
	.source-rows li {
		padding: 0.65rem 0.65rem 0.7rem;
		border-bottom: 1px solid var(--line);
		scroll-margin: 0.25rem;
	}
	.source-rows li[data-highlighted] {
		background: var(--sand);
		outline: 1px solid #b89652;
		outline-offset: -1px;
		border-radius: 0.3rem;
	}
	.source-rows li:focus-visible {
		outline: 2px solid var(--pine);
		outline-offset: -2px;
	}
	.source-meta {
		display: flex;
		gap: 0.55rem;
		color: var(--pine);
		font-size: 0.78rem;
	}
	.source-meta .mono,
	.source-time {
		color: var(--muted);
	}
	.source-time {
		margin: 0.23rem 0 0;
		font-size: 0.7rem;
	}
	.source-text {
		margin: 0.35rem 0 0;
		white-space: pre-wrap;
	}
	mark {
		background: #f3d47f;
		color: #312905;
	}
</style>
