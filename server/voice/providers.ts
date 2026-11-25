// Voice provider calls, ported from okami_voice/src/providers.ts (research
// half) plus the post-call Dify assessment the okami_voice demo ran after
// the call. One fetch helper with a timeout and non-2xx rejection; every
// credential stays in config and never reaches an error message.
import type { VoiceConfig } from './config';
import { DIFY_RUN_TIMEOUT_MS, readDifyReport } from './dify-stream';
import type { Locale } from '#shared/types/domain';
import { DEEP_RESEARCH_PROMPT } from './prompt';

export type VoiceBusiness = {
	businessName: string;
	location: string;
};

export type VoiceResearchCase = {
	title: string;
	company: string;
	problem: string;
	solution: string;
	outcome: string;
	applicability: string;
	costComplexity: string;
	sourceUrls: string[];
};

export type VoiceResearchReport = {
	/** The dossier body in Markdown, with inline citation markers. */
	answer: string;
	/** The sources behind the citations, in citation order. */
	sources: { name: string; url: string }[];
};

export class ProviderError extends Error {
	status: number;

	constructor(provider: string, status: number) {
		super(`${provider} returned HTTP ${status}`);
		this.status = status;
	}
}

export function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ?
			(value as Record<string, unknown>)
		:	undefined;
}

function nonempty(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const caseProperties = {
	title: { type: 'string' },
	company: { type: 'string' },
	problem: { type: 'string' },
	solution: { type: 'string' },
	outcome: { type: 'string' },
	applicability: { type: 'string' },
	cost_complexity: { type: 'string' },
	source_urls: { type: 'array', items: { type: 'string' } },
};

const researchSchema = {
	type: 'object',
	properties: {
		cases: {
			type: 'array',
			items: {
				type: 'object',
				properties: caseProperties,
				required: Object.keys(caseProperties),
				additionalProperties: false,
			},
		},
	},
	required: ['cases'],
	additionalProperties: false,
};

function publicSource(value: unknown): boolean {
	if (typeof value !== 'string' || value.length > 2048) {
		return false;
	}
	const url = URL.parse(value);
	return (
		url !== null
		&& (url.protocol === 'https:' || url.protocol === 'http:')
		&& !url.username
		&& !url.password
	);
}

/** Validates and trims Linkup's structured output into wire cases. */
export function readCases(value: unknown): VoiceResearchCase[] {
	const cases = object(value)?.cases;
	if (!Array.isArray(cases)) {
		throw new Error('Linkup returned an invalid case list');
	}
	return cases
		.flatMap((item: unknown) => {
			const entry = object(item);
			const company = nonempty(entry?.company);
			const solution = nonempty(entry?.solution);
			const urls = entry?.source_urls;
			if (!company || !solution || !Array.isArray(urls)) {
				return [];
			}
			const sources = [...new Set(urls.filter(publicSource))].slice(0, 3);
			if (sources.length === 0) {
				return [];
			}
			return [
				{
					title: nonempty(entry?.title)?.slice(0, 160) ?? '',
					company: company.slice(0, 200),
					problem: nonempty(entry?.problem)?.slice(0, 500) ?? '',
					solution: solution.slice(0, 500),
					outcome: nonempty(entry?.outcome)?.slice(0, 500) ?? '',
					applicability:
						nonempty(entry?.applicability)?.slice(0, 500) ?? '',
					costComplexity:
						nonempty(entry?.cost_complexity)?.slice(0, 500) ?? '',
					sourceUrls: sources,
				},
			];
		})
		.slice(0, 5);
}

/**
 * Validates and trims Linkup's `sourcedAnswer` output into the deep-pass
 * dossier: the report body plus the sources its citations point at. The
 * body is capped so the serialized evidence fits the Dify input budget.
 */
export function readResearchReport(value: unknown): VoiceResearchReport {
	const entry = object(value);
	const answer = nonempty(entry?.answer);
	if (!answer) {
		throw new Error('Linkup returned an invalid research report');
	}
	const listed = entry?.sources;
	const sources = (Array.isArray(listed) ? listed : [])
		.flatMap((item: unknown) => {
			const source = object(item);
			const name = nonempty(source?.name)?.slice(0, 200);
			const url =
				typeof source?.url === 'string' && publicSource(source.url) ?
					source.url.slice(0, 500)
				:	undefined;
			if (!name || !url) {
				return [];
			}
			return [{ name, url }];
		})
		.slice(0, 15);
	return { answer: answer.slice(0, 12_000), sources };
}

async function requestJson(
	provider: string,
	url: string,
	init: RequestInit,
	timeout = 15_000,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, {
		...init,
		redirect: 'manual',
		signal: AbortSignal.timeout(timeout),
	});
	if (!response.ok) {
		throw new ProviderError(provider, response.status);
	}
	const data = object(await response.json());
	if (!data) {
		throw new Error(`${provider} returned an invalid response`);
	}
	return data;
}

export type VoiceSessionToken = {
	conversationId: string;
	conversationToken: string;
};

/** Everything the Dify assessment needs, pre-serialized by the caller. */
export type VoiceAssessmentInput = {
	conversationId: string;
	transcript: string;
	/** Business intake as JSON text ('' when the row predates intake). */
	business: string;
	/** Research evidence as JSON text ('[]' when research failed). */
	cases: string;
	language: Locale;
};

export type ResearchRequest = {
	/**
	 * Linkup reasoning depth. The in-call pass stays 'S' (2-5 minutes, so
	 * cases arrive while the owner is still talking); the post-call deep
	 * pass passes 'XL' — see server/voice/deep-research.ts.
	 */
	reasoningDepth?: 'S' | 'M' | 'L' | 'XL';
	/** Complete prompt override; [LOCATION] is still filled. */
	prompt?: string;
	/**
	 * 'cases' (the default) returns the validated structured case list for
	 * the in-call pass; 'report' returns a full sourced dossier as natural
	 * language — the post-call deep pass reads that instead.
	 */
	output?: 'cases' | 'report';
};

export type VoiceProviders = {
	issueSession(): Promise<VoiceSessionToken>;
	startResearch(
		business: VoiceBusiness,
		request?: ResearchRequest,
	): Promise<string>;
	pollResearch(
		taskId: string,
	): Promise<
		| { status: 'waiting' }
		| { status: 'failed' }
		| { status: 'completed'; cases: VoiceResearchCase[] }
	>;
	pollResearchReport(
		taskId: string,
	): Promise<
		| { status: 'waiting' }
		| { status: 'failed' }
		| { status: 'completed'; report: VoiceResearchReport }
	>;
	runAssessment(input: VoiceAssessmentInput): Promise<string>;
};

export function createVoiceProviders(config: VoiceConfig): VoiceProviders {
	const linkupHeaders = {
		// Built separately so the credential never sits on a header-literal line.
		authorization: `Bearer ${config.linkupApiKey}`,
	};
	const linkupUrl = `${config.linkupApiBaseUrl}/v1/research`;

	async function pollTask(taskId: string): Promise<Record<string, unknown>> {
		return requestJson(
			'Linkup',
			`${linkupUrl}/${encodeURIComponent(taskId)}`,
			{ headers: linkupHeaders },
		);
	}

	return {
		async issueSession(): Promise<VoiceSessionToken> {
			const url = new URL(
				`${config.elevenLabsApiBaseUrl}/v1/convai/conversation/token`,
			);
			url.searchParams.set('agent_id', config.elevenLabsAgentId);
			const data = await requestJson('ElevenLabs', url.toString(), {
				headers: { 'xi-api-key': config.elevenLabsApiKey },
			});
			const conversationId = nonempty(data.conversation_id);
			const token = nonempty(data.token);
			if (!conversationId || !token) {
				throw new Error(
					'ElevenLabs did not return a conversation token and ID',
				);
			}
			return { conversationId, conversationToken: token };
		},

		async startResearch(
			business: VoiceBusiness,
			request: ResearchRequest = {},
		): Promise<string> {
			const base = (request.prompt ?? DEEP_RESEARCH_PROMPT).replaceAll(
				'[LOCATION]',
				business.location,
			);
			// The dossier pass gets the prompt as-is; the case pass adds the
			// five-case instruction that matches its structured schema.
			const q =
				request.output === 'report' ?
					base.trim()
				:	`${base.trim()}\n\nReturn up to five concise cases with sources. Give each case a short title that identifies the solution and the business that used it. Use an empty value for undocumented outcomes or implementation costs.`;
			const data = await requestJson('Linkup', linkupUrl, {
				method: 'POST',
				headers: {
					...linkupHeaders,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					q,
					mode: 'research',
					reasoningDepth: request.reasoningDepth ?? 'S',
					outputType:
						request.output === 'report' ?
							'sourcedAnswer'
						:	'structured',
					...(request.output === 'report' ?
						{}
					:	{
							structuredOutputSchema:
								JSON.stringify(researchSchema),
						}),
				}),
			});
			const id = nonempty(data.id);
			if (!id) {
				throw new Error('Linkup did not return a research task ID');
			}
			return id;
		},

		async pollResearch(taskId: string) {
			const data = await pollTask(taskId);
			switch (data.status) {
				case 'completed':
					return {
						status: 'completed',
						cases: readCases(data.output),
					} as const;
				case 'pending':
				case 'processing':
					return { status: 'waiting' } as const;
				case 'failed':
					return { status: 'failed' } as const;
				default:
					throw new Error('Linkup returned an unknown task status');
			}
		},

		async pollResearchReport(taskId: string) {
			const data = await pollTask(taskId);
			switch (data.status) {
				case 'completed':
					return {
						status: 'completed',
						report: readResearchReport(data.output),
					} as const;
				case 'pending':
				case 'processing':
					return { status: 'waiting' } as const;
				case 'failed':
					return { status: 'failed' } as const;
				default:
					throw new Error('Linkup returned an unknown task status');
			}
		},

		async runAssessment(input: VoiceAssessmentInput): Promise<string> {
			const response = await fetch(
				`${config.difyApiBaseUrl}/v1/workflows/run`,
				{
					method: 'POST',
					redirect: 'manual',
					signal: AbortSignal.timeout(DIFY_RUN_TIMEOUT_MS),
					headers: {
						// Built separately so the credential never sits on a
						// header-literal line.
						authorization: `Bearer ${config.difyApiKey}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						inputs: {
							transcript: input.transcript,
							business: input.business,
							research_cases: input.cases,
							report_language:
								input.language === 'ja' ?
									'Japanese'
								:	'English',
						},
						// Streaming, not blocking: deep research loops run minutes,
						// past the Dify Cloud blocking cap.
						response_mode: 'streaming',
						user: input.conversationId,
					}),
				},
			);
			if (!response.ok) {
				throw new ProviderError('Dify', response.status);
			}
			if (!response.body) {
				throw new Error('Dify returned an empty stream');
			}
			return readDifyReport(response.body);
		},
	};
}
