// Question speech for the live interview: one bounded text-to-speech request
// for the question the SERVER chose, never a general speech proxy. The text
// must arrive as a server-approved question object; browser input never
// reaches this module as directions or speech text. Redirects are rejected so
// the key and text are never relayed elsewhere, the response is streamed
// under a byte cap, and every failure is a fixed phrase — never a provider
// body, the key, or the question text. `fetchImpl` exists so tests (and a
// future loopback stub) can inject a transport without any external call.
import {
	TTS_MODEL_ID,
	TTS_OUTPUT_FORMAT,
	type VoiceLanguage,
	type VoiceProviderConfig,
	voiceIdForLanguage,
} from './config';
import { StageError } from '../../shared/p0/stages';
import { VoiceError } from './errors';

/** A question the server itself selected; the route resolves it server-side. */
export type ApprovedQuestion = {
	questionId: string;
	language: VoiceLanguage;
	text: string;
};

/** The synthesized question audio, fully buffered under the size cap. */
export type QuestionAudio = {
	contentType: string;
	bytes: Buffer;
};

/**
 * The provider-specific retention facts a deployment must disclose before any
 * live capture or speech synthesis. Fixed, reviewable text; no claims about
 * eligibility the app cannot verify. Zero retention is REQUESTED on every
 * connection/request but is only granted for eligible workspaces, so the
 * wording stays honest about default retention and possible US storage.
 */
export const LIVE_VOICE_DISCLOSURE =
	'Live audio is relayed from this server to the ElevenLabs realtime speech '
	+ 'API for transcription, and the text of each question is sent to the '
	+ 'ElevenLabs speech synthesis API to be spoken. Zero retention is requested '
	+ 'on every connection, but the provider applies it only for eligible '
	+ 'accounts; otherwise the provider may retain audio and transcripts under '
	+ 'its default settings and may store or process data in the United States. '
	+ 'This workbench stores no raw audio and no provider transcripts. You can '
	+ 'stop at any time, revoke consent for your own participation, and always '
	+ 'type answers instead of speaking.';

/** Validate a server-approved question locally before any provider contact. */
export function assertApprovedQuestion(question: ApprovedQuestion): void {
	if (
		typeof question.questionId !== 'string'
		|| question.questionId.length === 0
		|| question.questionId.length > 128
		|| !/^[A-Za-z0-9_.:-]+$/.test(question.questionId)
	) {
		throw new VoiceError('question_invalid', 'The question reference is not a usable server question id.');
	}
	if (
		typeof question.text !== 'string'
		|| question.text.trim().length === 0
		|| question.text.length > 500
	) {
		throw new VoiceError('question_invalid', 'The approved question text is missing or too long.');
	}
}

/**
 * Speak one server-chosen question. Exactly one outbound attempt, no retries,
 * no mode downgrade: on failure the caller keeps the question visible as text
 * (the contract requires the question text to be shown if speech fails).
 */
export async function speakApprovedQuestion(options: {
	config: VoiceProviderConfig;
	question: ApprovedQuestion;
	fetchImpl?: typeof fetch;
}): Promise<QuestionAudio> {
	const { config, question } = options;
	assertApprovedQuestion(question);
	const voiceId = voiceIdForLanguage(config, question.language);
	// The base URL is treated as an origin: the fixed endpoint path is
	// always appended exactly once, whatever the override carried.
	const httpsOrigin = new URL(config.baseHttpsUrl).origin;
	const url = `${httpsOrigin}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`
		+ `?output_format=${TTS_OUTPUT_FORMAT}&enable_logging=false`;
	const response = await boundedFetch(url, {
		method: 'POST',
		headers: {
			'xi-api-key': config.apiKey,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			text: question.text,
			model_id: TTS_MODEL_ID,
			language_code: question.language,
		}),
		redirect: 'error',
		timeoutMs: config.timeouts.ttsMs,
		fetchImpl: options.fetchImpl,
	});
	if (!response.ok) {
		throw new StageError('provider_failed', `Provider speech failed with status ${response.status}.`);
	}
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('audio/')) {
		throw new StageError(
			'invalid_model_output',
			'The provider returned speech in an unexpected format.',
		);
	}
	const bytes = await readBodyUnderCap(response, config.caps.maxTtsAudioBytes);
	return { contentType, bytes };
}

async function boundedFetch(
	url: string,
	init: RequestInit & { timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<Response> {
	const doFetch = init.fetchImpl ?? fetch;
	try {
		return await doFetch(url, {
			method: init.method,
			headers: init.headers,
			body: init.body,
			redirect: 'error',
			signal: AbortSignal.timeout(init.timeoutMs),
		});
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new StageError('provider_failed', 'Provider speech request timed out.');
		}
		throw new StageError('provider_failed', 'Provider speech request failed.');
	}
}

/** Stream the response body under a hard cap; never buffer without a limit. */
async function readBodyUnderCap(response: Response, capBytes: number): Promise<Buffer> {
	const declaredLength = Number(response.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLength) && declaredLength > capBytes) {
		throw speechTooLarge();
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw new StageError('provider_failed', 'Provider speech response could not be read.');
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const chunk = await reader.read().catch(() => null);
		if (chunk === null) {
			throw new StageError('provider_failed', 'Provider speech response could not be read.');
		}
		if (chunk.done) {
			break;
		}
		received += chunk.value.byteLength;
		if (received > capBytes) {
			await reader.cancel().catch(() => undefined);
			throw speechTooLarge();
		}
		chunks.push(chunk.value);
	}
	return Buffer.concat(chunks);
}

function speechTooLarge(): StageError {
	return new StageError('provider_failed', 'Provider speech exceeded the size limit.');
}
