// ElevenLabs batch speech-to-text client (recorded uploads only). One attempt
// per upload — never a duplicate paid retry — with a hard timeout, redirects
// rejected so audio and key are never relayed elsewhere, a response streamed
// under a byte cap, strict response validation, and redacted failures: status
// codes and fixed phrases only, never provider bodies, transcript text, or
// credentials. The raw audio is forwarded from memory and never written to disk.
import {
	AUDIO_MODEL_ID,
	type ProviderCleanup,
	type RecordingExtension,
	recordingMimeType,
} from '../../shared/p1/audio';
import type { AudioProviderConfig } from './config';
import { DELETE_TIMEOUT_MS } from './config';
import { StageError } from '../../shared/p0/stages';
import { z } from 'zod';

/** Bounded response: word-level detail for a 10 MiB recording stays far below. */
const MAX_RESPONSE_BYTES = 5_000_000;

const ScribeWordSchema = z.looseObject({
	text: z.string(),
	type: z.enum(['word', 'spacing', 'audio_event']),
	start: z.number().nullable().optional(),
	end: z.number().nullable().optional(),
	speaker_id: z.string().nullable().optional(),
});

const ScribeResponseSchema = z.looseObject({
	language_code: z.string(),
	language_probability: z.number(),
	text: z.string(),
	words: z.array(ScribeWordSchema),
	transcription_id: z.string().nullable().optional(),
});

export type ScribeWord = {
	text: string;
	type: 'word' | 'spacing' | 'audio_event';
	start: number | null;
	end: number | null;
	speaker_id: string | null;
};

export type Transcription = {
	languageCode: string | null;
	transcriptionId: string | null;
	words: ScribeWord[];
};

/**
 * Validate a parsed provider response body against the documented shape and
 * normalize it. Shape validation only: an empty word list still passes here
 * so the caller can run the best-effort cleanup before deciding the
 * transcription is unusable (see the transcribe route).
 */
export function parseScribeResponse(json: unknown): Transcription {
	const parsed = ScribeResponseSchema.safeParse(json);
	if (!parsed.success) {
		throw new StageError(
			'invalid_model_output',
			'The provider returned a transcription this workbench could not use.',
		);
	}
	const words: ScribeWord[] = parsed.data.words.map((word) => ({
		text: word.text,
		type: word.type,
		start: word.start ?? null,
		end: word.end ?? null,
		speaker_id: word.speaker_id ?? null,
	}));
	return {
		languageCode: parsed.data.language_code,
		transcriptionId: parsed.data.transcription_id ?? null,
		words,
	};
}

/** Transcribe one recording. Exactly one outbound attempt, no retries. */
export async function transcribeRecording(
	config: AudioProviderConfig,
	recording: { bytes: Buffer; extension: RecordingExtension },
): Promise<Transcription> {
	const form = new FormData();
	form.append('model_id', AUDIO_MODEL_ID);
	form.append('diarize', 'true');
	form.append('timestamps_granularity', 'word');
	// A generic basename: the original filename never leaves this process.
	form.append(
		'file',
		new Blob([new Uint8Array(recording.bytes)], {
			type: recordingMimeType(recording.extension),
		}),
		`recording.${recording.extension}`,
	);
	let response: Response;
	try {
		// Redirects are rejected outright: following one would relay the audio
		// and the API key to whatever endpoint the provider (or an impostor)
		// redirects to. The API never has a reason to redirect these calls.
		response = await fetch(`${config.baseUrl}/v1/speech-to-text`, {
			method: 'POST',
			headers: { 'xi-api-key': config.apiKey },
			body: form,
			redirect: 'error',
			signal: AbortSignal.timeout(config.timeoutMs),
		});
	} catch (error) {
		if (isTimeout(error)) {
			throw new StageError('provider_failed', 'Provider request timed out.');
		}
		throw new StageError('provider_failed', 'Provider request failed.');
	}
	if (!response.ok) {
		throw providerStatusFailed(response.status);
	}
	const text = await readBodyText(response);
	let json: unknown;
	try {
		json = JSON.parse(text) as unknown;
	} catch {
		throw new StageError(
			'invalid_model_output',
			'The provider returned a non-JSON transcription response.',
		);
	}
	return parseScribeResponse(json);
}

/**
 * Best-effort provider-side deletion of the stored transcription via the
 * documented `DELETE /v1/speech-to-text/transcripts/{transcription_id}`
 * endpoint. Outcomes are honest: `deleted` only after a confirmed 2xx,
 * `unavailable` when there is nothing retained under the id (404) or none
 * was returned, `failed` when the request could not be completed. Never
 * throws, never retries, never leaks response bodies.
 */
export async function deleteProviderTranscript(
	config: AudioProviderConfig,
	transcriptionId: string,
): Promise<'deleted' | 'unavailable' | 'failed'> {
	try {
		// Same redirect rejection as the upload: the key must not be relayed.
		const response = await fetch(
			`${config.baseUrl}/v1/speech-to-text/transcripts/${encodeURIComponent(transcriptionId)}`,
			{
				method: 'DELETE',
				headers: { 'xi-api-key': config.apiKey },
				redirect: 'error',
				signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
			},
		);
		if (response.ok) {
			return 'deleted';
		}
		if (response.status === 404) {
			return 'unavailable';
		}
	} catch {
		// Network/timeout failures fall through to `failed`.
	}
	return 'failed';
}

/**
 * Run the best-effort deletion for a schema-validated transcription id (or
 * report `unavailable` when none was returned) and log `failed` outcomes once
 * with a fixed phrase. Used for successful transcriptions and for responses
 * whose words turn out unusable — the provider may retain either way.
 */
export async function cleanupStoredTranscript(
	config: AudioProviderConfig,
	transcriptionId: string | null,
): Promise<ProviderCleanup> {
	if (transcriptionId === null) {
		return 'unavailable';
	}
	const outcome = await deleteProviderTranscript(config, transcriptionId);
	if (outcome === 'failed') {
		// Fixed phrase only: never the provider response or the id.
		console.error('[p1-audio] provider transcript deletion could not be confirmed.');
	}
	return outcome;
}

async function readBodyText(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
		throw responseTooLarge();
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw unreadableResponse();
	}
	// Stream under a hard byte cap: the body is never fully buffered without a
	// limit, even when the provider does not declare a Content-Length.
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const chunk = await reader.read().catch(() => null);
		if (chunk === null) {
			throw unreadableResponse();
		}
		if (chunk.done) {
			break;
		}
		received += chunk.value.byteLength;
		if (received > MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw responseTooLarge();
		}
		chunks.push(chunk.value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

function responseTooLarge(): StageError {
	return new StageError(
		'provider_failed',
		'Provider response exceeded the size limit.',
	);
}

function unreadableResponse(): StageError {
	return new StageError(
		'provider_failed',
		'Provider response could not be read.',
	);
}

function providerStatusFailed(status: number): StageError {
	return new StageError(
		'provider_failed',
		`Provider request failed with status ${status}.`,
	);
}

function isTimeout(error: unknown): boolean {
	return (
		error instanceof Error
		&& (error.name === 'TimeoutError' || error.name === 'AbortError')
	);
}
