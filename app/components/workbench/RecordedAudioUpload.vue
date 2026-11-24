<script setup lang="ts">
	// Self-contained recorded-upload control: consent + disclosure first, a
	// documented audio allowlist and size cap checked before the request, a
	// single visible pending state, and stale-result safety — an upload in
	// flight is aborted and its response discarded when the session changes,
	// and its draft is not appended when the session was revised in flight.
	import {
		MAX_RECORDING_BYTES,
		RECORDED_CONSENT_FIELD,
		RECORDED_CONSENT_VALUE,
		RECORDED_DISCLOSURE,
		RECORDING_ACCEPT,
		TranscribeResponseSchema,
		describeRecordingAllowlist,
		recordingExtensionOf,
	} from '#shared/p1/audio';
	import type { DraftSegment } from '#shared/p1/audio';
	import { ErrorBodySchema } from '#shared/p0/api';
	import { acceptsRecordedDraft } from '../../composables/workbenchModel';

	const props = defineProps<{
		/** `${clientId}/${sessionId}` of the interview this control serves. */
		sessionKey: string;
		/** Current revision of that interview; a finished draft must match. */
		revision: number;
		disabled: boolean;
	}>();
	const emit = defineEmits<{
		draft: [segments: DraftSegment[]];
	}>();

	const consent = ref(false);
	const file = ref<File | null>(null);
	const pending = ref(false);
	const error = ref('');
	const notice = ref('');
	const fileInput = ref<HTMLInputElement | null>(null);
	let requestEpoch = 0;
	let activeController: AbortController | null = null;

	function transcribeUrl(key: string): string {
		const [clientId = '', sessionId = ''] = key.split('/');
		return `/api/clients/${encodeURIComponent(clientId)}/sessions/${encodeURIComponent(sessionId)}/transcribe`;
	}

	const advice: Record<string, string> = {
		consent_required:
			'Consent was not accepted. Read the disclosure and acknowledge it again before retrying.',
		provider_unconfigured:
			'No transcription provider is configured on this server. Ask the operator to set the server-side key, or paste the transcript instead.',
		provider_failed:
			'The transcription provider did not complete the upload. Nothing was saved; the last saved transcript is unchanged.',
		invalid_model_output:
			'The provider returned a transcription this workbench could not use. Nothing was saved.',
		not_found: 'This interview no longer exists on the server.',
	};

	function messageFor(failure: unknown): string {
		const data =
			typeof failure === 'object' && failure !== null && 'data' in failure
				? (failure as { data?: unknown }).data
				: undefined;
		const parsed = ErrorBodySchema.safeParse(data);
		if (!parsed.success) {
			return 'Could not complete the request. Check the local server connection and try again; nothing was saved.';
		}
		const { code, message } = parsed.data.error;
		return [message, advice[code]].filter(Boolean).join(' ');
	}

	function preflight(selected: File): string | null {
		if (selected.size > MAX_RECORDING_BYTES) {
			return `Recording uploads are limited to ${Math.floor(MAX_RECORDING_BYTES / (1024 * 1024))} MiB.`;
		}
		if (recordingExtensionOf(selected.name) === null) {
			return `Recording files must be one of: ${describeRecordingAllowlist()}.`;
		}
		return null;
	}

	function reset() {
		consent.value = false;
		file.value = null;
		if (fileInput.value) {
			fileInput.value.value = '';
		}
	}

	function invalidate() {
		requestEpoch += 1;
		activeController?.abort();
		activeController = null;
		pending.value = false;
		error.value = '';
		notice.value = '';
		reset();
	}

	watch(
		() => props.sessionKey,
		() => invalidate(),
	);
	onUnmounted(() => invalidate());

	async function upload() {
		const selected = file.value;
		if (!selected || !consent.value || props.disabled || pending.value) {
			return;
		}
		error.value = '';
		notice.value = '';
		const problem = preflight(selected);
		if (problem) {
			error.value = problem;
			return;
		}
		const epoch = ++requestEpoch;
		const keyAtRequest = props.sessionKey;
		const revisionAtRequest = props.revision;
		const controller = new AbortController();
		activeController = controller;
		pending.value = true;
		try {
			const form = new FormData();
			form.append('file', selected);
			form.append(RECORDED_CONSENT_FIELD, RECORDED_CONSENT_VALUE);
			const response = await $fetch<unknown>(transcribeUrl(keyAtRequest), {
				method: 'POST',
				body: form,
				retry: 0,
				signal: controller.signal,
			});
			if (epoch !== requestEpoch || keyAtRequest !== props.sessionKey) {
				return; // Stale result for a session the user already left.
			}
			if (!acceptsRecordedDraft(revisionAtRequest, props.revision)) {
				// The interview was revised while the upload ran: appending
				// would mix rows across revisions. The save and any pasted
				// draft rows are untouched; the upload can simply be repeated.
				notice.value = STALE_REVISION_NOTICE;
				reset();
				return;
			}
			const parsed = TranscribeResponseSchema.safeParse(response);
			if (!parsed.success) {
				error.value =
					'The transcription response could not be validated. Nothing was saved.';
				reset();
				return;
			}
			// Unpersisted draft rows: the reviewer edits speakers/times in the
			// row editor and saves intentionally, or discards the draft.
			emit('draft', parsed.data.draft.segments);
			notice.value = cleanupNotice(parsed.data.cleanup);
			reset();
		} catch (failure) {
			if (
				failure instanceof Error
				&& (failure.name === 'AbortError' || failure.name === 'TimeoutError')
			) {
				return; // Aborted by session switch or unmount.
			}
			if (epoch !== requestEpoch || keyAtRequest !== props.sessionKey) {
				return;
			}
			error.value = messageFor(failure);
			reset();
		} finally {
			if (epoch === requestEpoch) {
				pending.value = false;
			}
		}
	}

	function cleanupNotice(state: string): string {
		const draftHint =
			'Draft rows are below: review speakers and times, then save or discard. The raw audio was not kept.';
		if (state === 'deleted') {
			return `Recording transcribed. The provider confirmed deleting its stored copy of this transcription. ${draftHint}`;
		}
		if (state === 'unavailable') {
			return `Recording transcribed. The provider did not report a stored transcription to delete; whether anything was retained depends on the provider account's logging settings. ${draftHint}`;
		}
		return `Recording transcribed, but the provider-side deletion request did not complete; whether the provider retained anything is unknown. ${draftHint}`;
	}

	const STALE_REVISION_NOTICE =
		'The interview changed while the transcription was in flight, so the draft rows were not added. Upload the recording again if you still need it. Nothing was saved.';
</script>

<template>
	<section
		class="recorded-upload stack"
		aria-labelledby="recorded-upload-heading"
	>
		<h3
			id="recorded-upload-heading"
			class="upload-heading"
		>
			Or transcribe a recording
		</h3>
		<p class="quiet fine">
			{{ RECORDED_DISCLOSURE }}
		</p>
		<label class="warning consent-row">
			<input
				v-model="consent"
				type="checkbox"
				:disabled="disabled || pending"
			/>
			Everyone in this recording agreed to be recorded and to have the
			audio transferred as described above.
		</label>
		<div class="actions">
			<label class="button file-button">
				{{ file ? file.name : 'Choose recording file' }}
				<input
					ref="fileInput"
					class="file-input"
					type="file"
					:accept="RECORDING_ACCEPT"
					:disabled="disabled || pending"
					@change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
				/>
			</label>
			<button
				class="button primary"
				type="button"
				:disabled="disabled || pending || !consent || !file"
				:aria-busy="pending"
				@click="upload"
			>
				{{ pending ? 'Transcribing…' : 'Upload recording' }}
			</button>
		</div>
		<p
			v-if="pending"
			class="quiet fine"
			role="status"
		>
			Uploading and transcribing — this app keeps no copy of the audio.
		</p>
		<p
			v-if="error"
			class="error-text"
			role="alert"
		>
			{{ error }}
		</p>
		<p
			v-if="notice && !error"
			class="quiet fine"
		>
			{{ notice }}
		</p>
	</section>
</template>

<style scoped>
	.recorded-upload {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}
	.upload-heading {
		margin: 0;
		font: 700 0.85rem var(--mono);
		color: var(--pine);
	}
	.consent-row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.file-button {
		position: relative;
		overflow: hidden;
		cursor: pointer;
		max-width: 22rem;
		white-space: nowrap;
		overflow-x: hidden;
		text-overflow: ellipsis;
	}
	.file-input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
</style>
