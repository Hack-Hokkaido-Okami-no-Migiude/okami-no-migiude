// POST /api/voice/elevenlabs/post-call — ElevenLabs post-call transcription
// webhook. Server-to-server: HMAC-verified with ELEVENLABS_WEBHOOK_SECRET
// (no session cookie, no same-origin check). Two destinations:
// 1. previously created voice sessions (kept working after the /voice
//    retirement — conversation only, no interview or report rows);
// 2. live interviews, matched through the server-issued interview id the
//    page passed to the widget as a dynamic variable, so the transcript
//    still lands after the owner has left the page. A stored live
//    transcript marks the interview submitted and arms the Dify
//    assessment; without DIFY_API_KEY the transcript is stored but the
//    assessment is marked failed (honest unavailable state on the site).
import { getHeader } from 'h3';
import { defineApi, sendJson } from '../../../utils/api';
import { apiError } from '../../../utils/errors';
import { readJsonObject } from '../../../utils/validate';
import {
	readVoiceConfig,
	agentConfigured,
	difyConfigured,
} from '../../../voice/config';
import {
	findVoiceSessionByConversation,
	saveVoiceTranscript,
	enqueueVoiceAssessment,
} from '../../../voice/model';
import {
	findInterviewById,
	saveLiveInterviewTranscript,
	enqueueInterviewAssessment,
	failInterviewAssessment,
} from '../../../model/interviews';
import { nowIso } from '../../../utils/clock';
import { object } from '../../../voice/providers';
import {
	requiredWebhookString,
	readWebhookInterviewId,
	toTranscript,
	verifyWebhook,
} from '../../../voice/webhooks';

const BODY_LIMIT = 1024 * 1024;

export default defineApi(async (event) => {
	const config = readVoiceConfig();
	if (!agentConfigured()) {
		throw apiError(
			503,
			'voice_unavailable',
			'Voice chat is not configured on this deployment',
		);
	}
	const raw = await readRawBody(event, BODY_LIMIT);
	if (
		!verifyWebhook(
			raw,
			getHeader(event, 'elevenlabs-signature') ?? null,
			config.elevenLabsWebhookSecret,
		)
	) {
		throw apiError(401, 'unauthorized', 'Invalid webhook signature');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.toString('utf8'));
	} catch {
		throw apiError(400, 'validation', 'Request body must be valid JSON');
	}
	const body = readJsonObject(parsed);
	if (body.type !== 'post_call_transcription') {
		return sendJson(event, 200, { received: true });
	}
	const data = object(body.data);
	if (!data || data.agent_id !== config.elevenLabsAgentId) {
		return sendJson(event, 200, { received: true });
	}
	const conversationId = requiredWebhookString(data, 'conversation_id');
	if (!conversationId) {
		throw apiError(400, 'validation', 'Missing conversation_id');
	}
	if (!Array.isArray(data.transcript)) {
		throw apiError(400, 'validation', 'Missing transcript');
	}
	const transcript = toTranscript(data.transcript);
	if (findVoiceSessionByConversation(conversationId)) {
		saveVoiceTranscript(conversationId, transcript);
		// A stored transcript arms the Dify assessment (idempotent). Without
		// DIFY_API_KEY the assessment stays idle: conversation + research only.
		if (difyConfigured()) {
			enqueueVoiceAssessment(conversationId);
		}
		return sendJson(event, 200, { received: true });
	}
	const interviewId = readWebhookInterviewId(data);
	if (interviewId && findInterviewById(interviewId)) {
		const outcome = saveLiveInterviewTranscript(
			interviewId,
			transcript,
			nowIso(),
		);
		if (outcome === 'stored') {
			// One submitted interview per owner: the interview is submitted
			// here. With DIFY_API_KEY the Dify assessment starts; without it
			// the assessment is failed immediately so the site can show the
			// honest unavailable state instead of "preparing" forever.
			if (difyConfigured()) {
				enqueueInterviewAssessment(interviewId);
			} else {
				failInterviewAssessment(interviewId, 0);
			}
		}
	}
	return sendJson(event, 200, { received: true });
});

async function readRawBody(
	event: import('h3').H3Event,
	limit: number,
): Promise<Buffer> {
	const request = event.node.req;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request.iterator({ destroyOnReturn: false })) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (size > limit) {
			request.resume();
			throw apiError(
				413,
				'payload_too_large',
				'Request body is too large',
			);
		}
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, size);
}
