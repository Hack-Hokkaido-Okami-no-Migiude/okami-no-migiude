// POST …/sessions/:sessionId/transcribe — recorded upload (P1, optional):
// validate the multipart recording and scope, require the explicit consent
// acknowledgement, transcribe once against the configured batch provider, and
// return UNPERSISTED review draft rows. Nothing is written to the session
// here; the consultant reviews speakers/times in the row editor and saves
// intentionally through the CAS-guarded transcript PUT. The raw audio and the
// provider response are never stored by this app; a best-effort provider-side
// deletion runs for every schema-validated transcription id — including
// responses whose words turn out unusable, which fail with a fixed, honest
// cleanup phrase and never leak the id.
import {
	RECORDED_CONSENT_REQUIRED_MESSAGE,
	RECORDED_CONSENT_VALUE,
	TranscribeResponseSchema,
} from '~~/shared/p1/audio';
import {
	cleanupStoredTranscript,
	transcribeRecording,
} from '~~/server/audio/provider';
import {
	httpError,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import type { ProviderCleanup } from '~~/shared/p1/audio';
import { StageError } from '~~/shared/p0/stages';
import { audioProviderConfig } from '~~/server/audio/config';
import { defineEventHandler } from 'h3';
import {
	draftTranscriptFromWords,
} from '~~/server/audio/draft';
import {
	readRecordingUpload,
} from '~~/server/audio/recordings';
import {
	readSession,
} from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const sessionKey = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		// Scope first: an unknown session fails before the body is buffered.
		const current = await readSession(sessionKey);
		if (!current) {
			throw httpError(404, 'not_found', 'Unknown client or session.');
		}
		const upload = await readRecordingUpload(event);
		if (upload.consentFieldValue !== RECORDED_CONSENT_VALUE) {
			// Rejected before any outbound request is made.
			throw httpError(422, 'consent_required', RECORDED_CONSENT_REQUIRED_MESSAGE);
		}

		const config = audioProviderConfig();
		const transcription = await transcribeRecording(config, {
			bytes: upload.bytes,
			extension: upload.extension,
		});
		// Cleanup runs before the draft is judged: even a response with
		// unusable words may carry a schema-validated transcription id, and
		// the provider may retain it unless the deletion is attempted.
		const cleanup = await cleanupStoredTranscript(
			config,
			transcription.transcriptionId,
		);
		let draft: ReturnType<typeof draftTranscriptFromWords>;
		try {
			draft = draftTranscriptFromWords(transcription.words);
		} catch {
			// More rows than the workbench accepts; the cleanup already ran.
			throw new StageError('provider_failed', unusableTranscriptionMessage(cleanup));
		}
		if (draft.segments.length === 0) {
			// Empty or unusable words: fail with the honest cleanup outcome.
			throw new StageError('invalid_model_output', unusableTranscriptionMessage(cleanup));
		}
		return TranscribeResponseSchema.parse({
			draft,
			languageCode: transcription.languageCode,
			cleanup,
		});
	}),
);

/** Fixed, honest cleanup outcome for an unusable transcription; no id in it. */
function unusableTranscriptionMessage(cleanup: ProviderCleanup): string {
	if (cleanup === 'deleted') {
		return 'The provider returned a transcription this workbench could not use; the provider-side stored copy was deleted.';
	}
	if (cleanup === 'unavailable') {
		return 'The provider returned a transcription this workbench could not use; the provider reported no stored copy to delete.';
	}
	return 'The provider returned a transcription this workbench could not use; deleting the provider-side stored copy could not be confirmed.';
}
