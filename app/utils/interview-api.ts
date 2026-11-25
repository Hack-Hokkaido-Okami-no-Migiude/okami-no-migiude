// Interview API client for the embedded-agent surface (/interview).
// Transport is injected so the client stays pure and unit-testable; the page
// supplies a `$fetch`-backed transport. The consent payload is fixed here:
// the client always sends `consent: true` with `mode: 'live'` — the headless
// demo verification path drives `mode: 'demo'` directly against the API and
// never through this client. The transcript itself is not submitted from the
// page at all: the post-call webhook (HMAC, server-to-server) delivers it,
// matched by the server-issued interview id.

import type {
	InterviewAssessmentSurface,
	InterviewCurrent,
	InterviewResearchSurface,
} from '../../shared/types/domain.ts';

export type AgentAvailability = {
	/** Full voice-session stack (existing conversations keep working). */
	available: boolean;
	/** The embedded-agent interview surface (agent id + webhook secret). */
	agentAvailable: boolean;
	/** The Dify post-call assessment (DIFY_API_KEY). */
	reportEngineAvailable: boolean;
	/** Public widget identifier; '' when the agent is not configured. */
	agentId: string;
};

export type InterviewHttpResponse = {
	status: number;
	json: unknown;
	networkError?: boolean;
};

export type InterviewHttp = (
	path: string,
	init: { method: 'GET' | 'POST'; body?: unknown },
) => Promise<InterviewHttpResponse>;

export type InterviewsCurrentResult = {
	interview: InterviewCurrent | null;
	reportId: string | null;
};

export type InterviewClient = {
	availability(): Promise<AgentAvailability>;
	current(): Promise<InterviewsCurrentResult>;
	start(): Promise<{ interview: InterviewCurrent }>;
};

export class ApiFailure extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message?: string) {
		super(message ?? code);
		this.name = 'ApiFailure';
		this.status = status;
		this.code = code;
	}
}

const RESEARCH_STATUSES = new Set([
	'idle',
	'queued',
	'submitting',
	'polling',
	'completed',
	'failed',
]);
const ASSESSMENT_STATUSES = new Set([
	'idle',
	'queued',
	'running',
	'completed',
	'failed',
]);

function assertInterviewCurrent(
	value: unknown,
	status: number,
): InterviewCurrent {
	if (
		typeof value === 'object'
		&& value !== null
		&& typeof (value as { id?: unknown }).id === 'string'
		&& ((value as { status?: unknown }).status === 'active'
			|| (value as { status?: unknown }).status === 'submitted')
		&& typeof (value as { deadlineAt?: unknown }).deadlineAt === 'string'
		&& ((value as { mode?: unknown }).mode === 'demo'
			|| (value as { mode?: unknown }).mode === 'live')
	) {
		const current = value as InterviewCurrent;
		if (current.research !== undefined) {
			assertResearchSurface(current.research, status);
		}
		if (current.assessment !== undefined) {
			assertAssessmentSurface(current.assessment, status);
		}
		return current;
	}
	throw new ApiFailure(status, 'internal', 'Unexpected interview response');
}

function assertResearchSurface(
	value: unknown,
	status: number,
): asserts value is InterviewResearchSurface {
	const surface = value as { status?: unknown; cases?: unknown };
	if (
		typeof surface?.status !== 'string'
		|| !RESEARCH_STATUSES.has(surface.status)
		|| !(surface.cases === null || Array.isArray(surface.cases))
	) {
		throw new ApiFailure(
			status,
			'internal',
			'Unexpected interview response',
		);
	}
}

function assertAssessmentSurface(
	value: unknown,
	status: number,
): asserts value is InterviewAssessmentSurface {
	const surface = value as { status?: unknown; reportId?: unknown };
	if (
		typeof surface?.status !== 'string'
		|| !ASSESSMENT_STATUSES.has(surface.status)
		|| !(surface.reportId === null || typeof surface.reportId === 'string')
	) {
		throw new ApiFailure(
			status,
			'internal',
			'Unexpected interview response',
		);
	}
}

function failWithEnvelope(response: { status: number; json: unknown }): never {
	const envelope =
		typeof response.json === 'object' && response.json !== null ?
			(response.json as { error?: unknown; message?: unknown })
		:	{};
	const code =
		typeof envelope.error === 'string' ? envelope.error : 'internal';
	const message =
		typeof envelope.message === 'string' ? envelope.message : undefined;
	throw new ApiFailure(response.status, code, message);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function createInterviewClient(http: InterviewHttp): InterviewClient {
	async function send(
		path: string,
		method: 'GET' | 'POST',
		body?: unknown,
	): Promise<{ status: number; json: unknown }> {
		let response: InterviewHttpResponse;
		try {
			response = await http(path, { method, body });
		} catch {
			throw new ApiFailure(0, 'network', 'Network request failed');
		}
		if (response.networkError) {
			throw new ApiFailure(0, 'network', 'Network request failed');
		}
		return { status: response.status, json: response.json };
	}

	return {
		async availability(): Promise<AgentAvailability> {
			const response = await send('/api/voice/config', 'GET');
			if (response.status !== 200) {
				failWithEnvelope(response);
			}
			const json = response.json;
			if (
				!isJsonObject(json)
				|| typeof json.available !== 'boolean'
				|| typeof json.agentAvailable !== 'boolean'
				|| typeof json.reportEngineAvailable !== 'boolean'
				|| typeof json.agentId !== 'string'
			) {
				failWithEnvelope(response);
			}
			return json as unknown as AgentAvailability;
		},

		async current(): Promise<InterviewsCurrentResult> {
			const response = await send('/api/interviews/current', 'GET');
			if (response.status !== 200) {
				failWithEnvelope(response);
			}
			const json = response.json;
			if (
				!isJsonObject(json)
				|| !('interview' in json)
				|| !('reportId' in json)
			) {
				failWithEnvelope(response);
			}
			let interview: InterviewCurrent | null = null;
			if (json.interview !== null && json.interview !== undefined) {
				interview = assertInterviewCurrent(
					json.interview,
					response.status,
				);
			}
			let reportId: string | null = null;
			if (json.reportId !== null && json.reportId !== undefined) {
				if (typeof json.reportId !== 'string') {
					failWithEnvelope(response);
				}
				reportId = json.reportId;
			}
			return { interview, reportId };
		},

		async start(): Promise<{ interview: InterviewCurrent }> {
			const response = await send('/api/interviews/start', 'POST', {
				consent: true,
				mode: 'live',
			});
			if (response.status !== 200 && response.status !== 201) {
				failWithEnvelope(response);
			}
			const json = response.json;
			if (!isJsonObject(json)) {
				failWithEnvelope(response);
			}
			return {
				interview: assertInterviewCurrent(
					json.interview,
					response.status,
				),
			};
		},
	};
}
