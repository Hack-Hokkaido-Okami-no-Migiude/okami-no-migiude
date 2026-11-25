// Interview API client (contract §5 endpoints). Transport is injected so the
// client stays pure and unit-testable; the Nuxt page supplies a `$fetch`-backed
// transport. The demo consent payload is fixed here — the client can never be
// coaxed into sending `mode: 'live'` or a non-boolean consent.

import type { InterviewCurrent } from '../../shared/types/domain.ts';

export type InterviewHttpResponse = {
	status: number;
	json: unknown;
	networkError?: boolean;
};

export type InterviewHttp = (
	path: string,
	init: { method: 'GET' | 'POST'; body?: unknown },
) => Promise<InterviewHttpResponse>;

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

export type InterviewsCurrentResult = {
	interview: InterviewCurrent | null;
	reportId: string | null;
};

export type InterviewClient = {
	current(): Promise<InterviewsCurrentResult>;
	start(): Promise<{ interview: InterviewCurrent }>;
	complete(
		interviewId: string,
		transcript: string,
	): Promise<{ interview: InterviewCurrent; reportId: string }>;
};

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
		return value as InterviewCurrent;
	}
	throw new ApiFailure(status, 'internal', 'Unexpected interview response');
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
				mode: 'demo',
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

		async complete(
			interviewId: string,
			transcript: string,
		): Promise<{ interview: InterviewCurrent; reportId: string }> {
			const response = await send(
				`/api/interviews/${encodeURIComponent(interviewId)}/complete`,
				'POST',
				{ transcript },
			);
			if (response.status !== 200) {
				failWithEnvelope(response);
			}
			const json = response.json;
			if (!isJsonObject(json) || typeof json.reportId !== 'string') {
				failWithEnvelope(response);
			}
			return {
				interview: assertInterviewCurrent(
					json.interview,
					response.status,
				),
				reportId: json.reportId,
			};
		},
	};
}
