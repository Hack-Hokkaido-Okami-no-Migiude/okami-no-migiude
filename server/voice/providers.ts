// Voice provider calls, ported from okami_voice/src/providers.ts (Dify
// omitted — the assessment wiring comes later). One fetch helper with a
// timeout and non-2xx rejection; every credential stays in config and never
// reaches an error message.
import type { VoiceConfig } from './config';
import { DEEP_RESEARCH_PROMPT } from './prompt';

export type VoiceBusiness = {
	businessName: string;
	location: string;
	businessType: string;
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

export type VoiceProviders = {
	issueSession(): Promise<VoiceSessionToken>;
	startResearch(business: VoiceBusiness): Promise<string>;
	pollResearch(
		taskId: string,
	): Promise<
		| { status: 'waiting' }
		| { status: 'failed' }
		| { status: 'completed'; cases: VoiceResearchCase[] }
	>;
};

export function createVoiceProviders(config: VoiceConfig): VoiceProviders {
	const linkupHeaders = {
		// Built separately so the credential never sits on a header-literal line.
		authorization: `Bearer ${config.linkupApiKey}`,
	};
	const linkupUrl = `${config.linkupApiBaseUrl}/v1/research`;

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

		async startResearch(business: VoiceBusiness): Promise<string> {
			const fields: Record<string, string> = {
				LOCATION: business.location,
				BUSINESS_TYPE: business.businessType,
			};
			const q = DEEP_RESEARCH_PROMPT.replace(
				/\[(LOCATION|BUSINESS_TYPE)\]/g,
				(_, key: string) => fields[key],
			);
			const data = await requestJson('Linkup', linkupUrl, {
				method: 'POST',
				headers: {
					...linkupHeaders,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					q: `${q.trim()}\n\nReturn up to five concise cases with sources. Give each case a short title that identifies the solution and the business that used it. Use an empty value for undocumented outcomes or implementation costs.`,
					mode: 'research',
					reasoningDepth: 'S',
					outputType: 'structured',
					structuredOutputSchema: JSON.stringify(researchSchema),
				}),
			});
			const id = nonempty(data.id);
			if (!id) {
				throw new Error('Linkup did not return a research task ID');
			}
			return id;
		},

		async pollResearch(taskId: string) {
			const data = await requestJson(
				'Linkup',
				`${linkupUrl}/${encodeURIComponent(taskId)}`,
				{ headers: linkupHeaders },
			);
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
	};
}
