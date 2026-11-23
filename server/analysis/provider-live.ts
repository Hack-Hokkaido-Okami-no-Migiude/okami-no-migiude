// Live provider: a minimal OpenAI-compatible chat-completions client used only
// from the server. Fixed instructions stay server-owned; the projected session
// data is passed as untrusted content. One retry, and only for timeout/429/5xx.
import type { AnalysisProvider } from './provider';
import { StageError } from '../../shared/p0/stages';
import { createHash } from 'node:crypto';

export type LiveProviderConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutMs?: number;
};

const STAGE_INSTRUCTIONS: Record<'extract' | 'assess' | 'propose', string> = {
	extract:
		'You extract a workflow as JSON from an interview transcript. Respond with JSON only, matching the extraction schema: steps (key, label, role, tool, execution, evidence quotes, anchors), transitions (only when the quote contains an explicit trigger/handoff/sequence phrase), unknowns, opportunities.',
	assess: 'You assess candidate workflow transitions against the original source text. Respond with JSON only: acceptedTransitionKeys, rejected (key, reason, detail), notices. Accept a transition only when its quote contains an explicit trigger, handoff, or sequence phrase linking both endpoints.',
	propose:
		'You propose an improved workflow and implementation plan for one opportunity. Respond with JSON only: planKey, steps (key, label, currentStepIds, evidence), edges (key, fromKey, toKey, label, evidence), planSections with all seven section keys.',
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
		key: `live:${config.model}:${baseUrlHash}`,
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
	const response = await postWithOneRetry(config, payload);
	if (!response.ok) {
		throw new StageError(
			'provider_failed',
			`Provider request failed with status ${response.status}.`,
		);
	}
	const body = (await response.json()) as {
		choices?: { message?: { content?: unknown } }[];
	};
	const content = body.choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new StageError(
			'invalid_model_output',
			'Provider response is missing message content.',
		);
	}
	return content;
}

async function postWithOneRetry(
	config: LiveProviderConfig,
	payload: unknown,
): Promise<Response> {
	const attempt = (): Promise<Response> =>
		fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
		});
	try {
		const response = await attempt();
		const retryable = response.status === 429 || response.status >= 500;
		if (!retryable) {
			return response;
		}
	} catch (error) {
		const isTimeout =
			error instanceof Error && error.name === 'TimeoutError';
		if (!isTimeout) {
			throw new StageError('provider_failed', 'Provider request failed.');
		}
	}
	return attempt();
}
