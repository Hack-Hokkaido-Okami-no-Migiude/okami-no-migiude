// Live provider: a minimal OpenAI-compatible chat-completions client used only
// from the server. Fixed instructions stay server-owned; the projected session
// data is serialized as untrusted content, separate from those instructions, and
// no tool calling is offered. Bounds: per-call timeout, request/response size
// caps, and at most one retry per operation — only for timeouts, 429, and 5xx.
// Failures are redacted: status codes and fixed phrases only, never provider
// bodies, transcript text, or credentials.
import type { AnalysisProvider } from './provider';
import { StageError } from '../../shared/p0/stages';
import { createHash } from 'node:crypto';

export type LiveProviderConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
	/** Per-call HTTP timeout in milliseconds (default 60s). */
	timeoutMs?: number;
};

/** Bump when the fixed stage instructions change in shape or meaning. */
const PROMPT_VERSION = 2;

const STAGE_INSTRUCTIONS: Record<'extract' | 'assess' | 'propose', string> = {
	extract:
		'You extract a workflow as JSON from an interview transcript. Respond with JSON only, matching the extraction schema: steps (key, label, role, tool, execution, evidence quotes, anchors), transitions (only when the quote contains an explicit trigger/handoff/sequence phrase), unknowns, opportunities. Use the reserved id prefixes for local keys: step_, edge_, q_, opp_. Saved answers in the input are citable sources like transcript rows: cite them by their answerId/answerRev and quote the answer text verbatim.',
	assess: 'You assess candidate workflow transitions against the original source text. Respond with JSON only: acceptedTransitionKeys, rejected (key, reason, detail), notices. Accept a transition only when its quote contains an explicit trigger, handoff, or sequence phrase linking both endpoints.',
	propose:
		'You propose an improved workflow and implementation plan for one opportunity. Respond with JSON only: planKey, steps (key, label, currentStepIds, evidence), edges (key, fromKey, toKey, label, evidence), planSections with all seven section keys. Use the reserved id prefixes for local keys: pstep_, pedge_.',
};

/** Defensive caps; the stage projections already bound their own collections. */
const MAX_REQUEST_CHARS = 1_000_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;

type ChatCompletionBody = {
	choices?: { message?: { content?: unknown } }[];
};

export function createLiveProvider(
	config: LiveProviderConfig,
): AnalysisProvider {
	const configured =
		config.baseUrl.trim().length > 0
		&& config.apiKey.trim().length > 0
		&& config.model.trim().length > 0;
	if (!configured) {
		throw new StageError(
			'provider_unconfigured',
			'Live analysis is not configured (NUXT_LLM_BASE_URL, NUXT_LLM_API_KEY, NUXT_LLM_MODEL).',
		);
	}
	const baseUrlHash = createHash('sha256')
		.update(config.baseUrl)
		.digest('hex')
		.slice(0, 12);
	return {
		mode: 'live',
		key: `live:${config.model}:${baseUrlHash}:prompt-v${PROMPT_VERSION}`,
		async run(operation, input) {
			const content = await requestChatCompletion(
				config,
				operation,
				input,
			);
			try {
				return JSON.parse(content) as unknown;
			} catch {
				throw new StageError(
					'invalid_model_output',
					'Provider returned malformed JSON.',
				);
			}
		},
	};
}

async function requestChatCompletion(
	config: LiveProviderConfig,
	operation: 'extract' | 'assess' | 'propose',
	input: unknown,
): Promise<string> {
	const payload = {
		model: config.model,
		messages: [
			{ role: 'system', content: STAGE_INSTRUCTIONS[operation] },
			{
				role: 'user',
				content: `UNTRUSTED INTERVIEW DATA (JSON):\n${JSON.stringify(input)}`,
			},
		],
	};
	const serialized = JSON.stringify(payload);
	if (serialized.length > MAX_REQUEST_CHARS) {
		throw new StageError(
			'provider_failed',
			'Projected analysis input exceeded the provider request size limit.',
		);
	}
	const response = await postWithOneRetry(config, serialized);
	if (!response.ok) {
		throw new StageError(
			'provider_failed',
			`Provider request failed with status ${response.status}.`,
		);
	}
	const body = await readResponseJson(response);
	const content = body.choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new StageError(
			'invalid_model_output',
			'Provider response is missing message content.',
		);
	}
	if (content.length > MAX_RESPONSE_CHARS) {
		throw new StageError(
			'provider_failed',
			'Provider response exceeded the size limit.',
		);
	}
	return content;
}

async function readResponseJson(
	response: Response,
): Promise<ChatCompletionBody> {
	const declaredLength = Number(response.headers.get('content-length') ?? '');
	if (
		Number.isFinite(declaredLength)
		&& declaredLength > MAX_RESPONSE_CHARS
	) {
		throw new StageError(
			'provider_failed',
			'Provider response exceeded the size limit.',
		);
	}
	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new StageError(
			'provider_failed',
			'Provider response could not be read.',
		);
	}
	if (text.length > MAX_RESPONSE_CHARS) {
		throw new StageError(
			'provider_failed',
			'Provider response exceeded the size limit.',
		);
	}
	try {
		return JSON.parse(text) as ChatCompletionBody;
	} catch {
		throw new StageError(
			'provider_failed',
			'Provider returned a non-JSON response body.',
		);
	}
}

async function postWithOneRetry(
	config: LiveProviderConfig,
	serializedPayload: string,
): Promise<Response> {
	const attempt = (): Promise<Response> =>
		fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${config.apiKey}`,
			},
			body: serializedPayload,
			signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
	let first: Response;
	try {
		first = await attempt();
	} catch (error) {
		if (!isTimeout(error)) {
			throw providerFailed('Provider request failed.');
		}
		// Timeouts are retryable: exactly one more attempt, then give up.
		return await guardedAttempt(attempt);
	}
	const retryable = first.status === 429 || first.status >= 500;
	if (!retryable) {
		return first;
	}
	return await guardedAttempt(attempt);
}

async function guardedAttempt(
	attempt: () => Promise<Response>,
): Promise<Response> {
	try {
		return await attempt();
	} catch (error) {
		throw providerFailed(
			isTimeout(error) ?
				'Provider request timed out.'
			:	'Provider request failed.',
		);
	}
}

function isTimeout(error: unknown): boolean {
	return (
		error instanceof Error
		&& (error.name === 'TimeoutError' || error.name === 'AbortError')
	);
}

function providerFailed(message: string): StageError {
	return new StageError('provider_failed', message);
}
