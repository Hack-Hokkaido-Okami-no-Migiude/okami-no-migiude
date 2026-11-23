<script setup lang="ts">
	import type {
		EvidenceRef,
		Segment,
		SegmentInput,
	} from '#shared/p0/types';
	import type { EvidenceSource } from '../../composables/workbenchDescriptors';
	import EvidenceSourceReader from './EvidenceSourceReader.vue';
	import { parseTranscriptPaste } from '../../composables/workbenchModel';
	import { registerWorkbenchDraft } from '../../composables/useDraftProtection';

	type DraftRow = {
		key: string;
		id?: string;
		text: string;
		speaker: string;
		startMs: number | '';
		endMs: number | '';
	};
	const props = defineProps<{
		segments: Segment[];
		answers: EvidenceSource[];
		hasTranscript: boolean;
		disabled: boolean;
		selected: EvidenceRef | null;
		jumpCount: number;
		save: (segments: SegmentInput[]) => Promise<boolean>;
		remove: () => Promise<boolean>;
	}>();
	const editing = ref(false);
	const deletePrompt = ref(false);
	const paste = ref('');
	const rows = ref<DraftRow[]>([]);
	const original = ref('');
	const overwriteAccepted = ref(false);
	const validation = ref('');
	let rowCounter = 0;
	const saved = computed(() => JSON.stringify(props.segments));
	const diverged = computed(
		() => editing.value && original.value !== saved.value,
	);
	const dirty = computed(
		() =>
			editing.value
			&& Boolean(
				paste.value || JSON.stringify(rows.value) !== initialRows.value,
			),
	);
	const initialRows = ref('');
	registerWorkbenchDraft(dirty);

	function draftRow({
		id,
		text,
		speaker,
		startMs,
		endMs,
	}: SegmentInput): DraftRow {
		return {
			key: id ?? `draft-${++rowCounter}`,
			...(id ? { id } : {}),
			text,
			speaker: speaker ?? '',
			startMs: startMs ?? '',
			endMs: endMs ?? '',
		};
	}

	function startEditing() {
		deletePrompt.value = false;
		rows.value = props.segments.map(draftRow);
		initialRows.value = JSON.stringify(rows.value);
		original.value = saved.value;
		overwriteAccepted.value = false;
		validation.value = '';
		paste.value = '';
		editing.value = true;
	}

	watch(saved, () => {
		overwriteAccepted.value = false;
	});

	function changeOrder(index: number, offset: number) {
		const [row] = rows.value.splice(index, 1);
		if (row) {
			rows.value.splice(index + offset, 0, row);
		}
	}

	function appendPaste() {
		const parsed = parseTranscriptPaste(paste.value);
		if (parsed.length) {
			rows.value.push(...parsed.map(draftRow));
		}
		if (parsed.length) {
			paste.value = '';
		}
	}

	function discardEditor() {
		if (
			!dirty.value
			|| window.confirm('Discard the current transcript draft?')
		) {
			editing.value = false;
		}
	}

	async function saveRows() {
		if (props.disabled || (diverged.value && !overwriteAccepted.value)) {
			return;
		}
		validation.value = '';
		if (paste.value.trim()) {
			appendPaste();
		}
		if (!rows.value.length) {
			validation.value =
				'Add at least one row. To clear saved material, use Delete transcript.';
			return;
		}
		const payload = rows.value.map(
			({ id, text, speaker, startMs, endMs }) => ({
				...(id ? { id } : {}),
				text,
				speaker: speaker.trim() ? speaker : null,
				startMs: startMs === '' ? null : startMs,
				endMs: endMs === '' ? null : endMs,
			}),
		);
		if (
			payload.some(
				({ text, startMs, endMs }) =>
					!text.trim()
					|| (startMs !== null && endMs !== null && endMs < startMs),
			)
		) {
			validation.value =
				'Give every row text, and make sure an end time does not precede its start.';
			return;
		}
		if (await props.save(payload)) {
			editing.value = false;
		}
	}

	async function deleteSaved() {
		if (await props.remove()) {
			deletePrompt.value = false;
		}
	}
</script>

<template>
	<section
		class="panel transcript-pane"
		aria-labelledby="transcript-heading"
	>
		<div class="panel-header">
			<div>
				<p class="eyebrow">01 / Source record</p>
				<h2 id="transcript-heading">Transcript</h2>
			</div>
			<span class="pill"
				>{{ segments.length }}
				{{ segments.length === 1 ? 'row' : 'rows' }}</span
			>
		</div>
		<div
			v-if="!editing"
			class="actions transcript-actions"
		>
			<button
				class="button"
				type="button"
				@click="startEditing"
			>
				{{ hasTranscript ? 'Edit transcript' : 'Paste transcript' }}
			</button>
			<button
				v-if="hasTranscript"
				class="button danger"
				type="button"
				:disabled="disabled"
				:aria-expanded="deletePrompt"
				@click="deletePrompt = !deletePrompt"
			>
				Delete transcript
			</button>
		</div>
		<div
			v-if="deletePrompt"
			class="deletion stack"
		>
			<p>
				This permanently removes the transcript, graph, questions,
				answers, opportunities and plans for this interview.
			</p>
			<div class="actions">
				<button
					class="button danger"
					type="button"
					:disabled="disabled"
					@click="deleteSaved"
				>
					Confirm transcript deletion
				</button>
				<button
					class="button"
					type="button"
					@click="deletePrompt = false"
				>
					Cancel
				</button>
			</div>
		</div>
		<form
			v-if="editing"
			class="stack editor"
			@submit.prevent="saveRows"
		>
			<label
				>Pasted interview text
				<textarea
					v-model="paste"
					dir="auto"
					rows="4"
					placeholder="[00:12–00:15] 受付：台帳を確認します。"
					aria-describedby="paste-format"
				/>
			</label>
			<p
				id="paste-format"
				class="quiet fine"
			>
				One row per nonblank line. For metadata use
				<code>[00:12–00:15] 受付：本文</code>,
				<code>[受付] 本文</code> or <code>Speaker: text</code>. The
				interview wording is not translated.
			</p>
			<div class="actions">
				<button
					class="button"
					type="button"
					:disabled="!paste.trim()"
					@click="appendPaste"
				>
					Add pasted rows
				</button>
				<button
					class="button"
					type="button"
					@click="rows.push(draftRow({ text: '' }))"
				>
					Add blank row
				</button>
			</div>
			<ol
				v-if="rows.length"
				class="draft-rows"
			>
				<li
					v-for="(row, index) in rows"
					:key="row.key"
				>
					<fieldset class="stack">
						<legend>Row {{ index + 1 }}</legend>
						<label
							>Speaker
							<input
								v-model="row.speaker"
								dir="auto"
						/></label>
						<div class="time-grid">
							<label
								>Start (ms)
								<input
									v-model.number="row.startMs"
									type="number"
									min="0"
									step="1"
							/></label>
							<label
								>End (ms)
								<input
									v-model.number="row.endMs"
									type="number"
									min="0"
									step="1"
							/></label>
						</div>
						<label
							>Interview text
							<textarea
								v-model="row.text"
								dir="auto"
								rows="2"
							/>
						</label>
						<div class="actions">
							<button
								class="button"
								type="button"
								:aria-label="`Move row ${index + 1} up`"
								:disabled="index === 0"
								@click="changeOrder(index, -1)"
							>
								↑ Up
							</button>
							<button
								class="button"
								type="button"
								:aria-label="`Move row ${index + 1} down`"
								:disabled="index === rows.length - 1"
								@click="changeOrder(index, 1)"
							>
								↓ Down
							</button>
							<button
								class="button"
								type="button"
								:aria-label="`Remove row ${index + 1}`"
								@click="rows.splice(index, 1)"
							>
								Remove
							</button>
						</div>
					</fieldset>
				</li>
			</ol>
			<p
				v-if="validation"
				class="error-text"
				role="alert"
			>
				{{ validation }}
			</p>
			<label
				v-if="diverged"
				class="warning"
				><input
					v-model="overwriteAccepted"
					type="checkbox"
				/>
				I compared my draft with the latest saved transcript below and
				want to replace those rows.</label
			>
			<div class="actions">
				<button
					class="button primary"
					type="submit"
					:disabled="
						disabled || !dirty || (diverged && !overwriteAccepted)
					"
				>
					Save transcript
				</button>
				<button
					class="button"
					type="button"
					@click="discardEditor"
				>
					Cancel editing
				</button>
			</div>
		</form>
		<h3 v-if="editing && hasTranscript">Saved source</h3>
		<EvidenceSourceReader
			:segments="segments"
			:answers="answers"
			:selected="selected"
			:jump-count="jumpCount"
		/>
	</section>
</template>

<style scoped>
	.transcript-actions {
		margin-bottom: 0.55rem;
	}
	.editor {
		padding-bottom: 0.8rem;
	}
	.editor p,
	.deletion p {
		margin: 0;
	}
	.draft-rows {
		list-style: none;
		padding: 0;
		margin: 0;
		max-height: 27rem;
		overflow: auto;
	}
	.draft-rows li {
		border-bottom: 1px solid var(--line);
		padding: 0.55rem 0.12rem 0.7rem;
	}
	legend {
		color: var(--pine);
		font: 700 0.78rem var(--mono);
		margin: 0 0 0.4rem;
	}
	.time-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.45rem;
	}
	.warning,
	.deletion {
		border-radius: 0.3rem;
		padding: 0.6rem;
		background: var(--sand);
	}
	.deletion {
		margin-bottom: 0.6rem;
	}
</style>
