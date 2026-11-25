// POST /api/voice/elevenlabs/start-research — webhook tool called by the
// ElevenLabs agent during a call. Server-to-server: no session cookie and no
// same-origin check; authentication is the shared RESEARCH_TOOL_SECRET.
// Research is normally queued when the session starts (profile intake), so
// this endpoint is an idempotent no-op that keeps the agent's existing tool
// configuration working.
import { getHeader } from 'h3';
import { defineApi, parseJsonBody, sendJson } from '../../../utils/api';
import { apiError } from '../../../utils/errors';
import { nowMs } from '../../../utils/clock';
import { readVoiceConfig, voiceConfigured } from '../../../voice/config';
import { queueVoiceResearch } from '../../../voice/model';
import { VOICE_RESEARCH_TIMEOUT_MS } from '../../../voice/jobs';
import { requiredWebhookString, secretMatches } from '../../../voice/webhooks';

export default defineApi(async (event) => {
	const config = readVoiceConfig();
	if (!voiceConfigured()) {
		throw apiError(
			503,
			'voice_unavailable',
			'Voice chat is not configured on this deployment',
		);
	}
	const bearer =
		getHeader(event, 'authorization')?.match(/^Bearer (\S+)$/i)?.[1] ?? '';
	if (!bearer || !secretMatches(bearer, config.researchToolSecret)) {
		throw apiError(401, 'unauthorized', 'Invalid tool token');
	}
	const body = await parseJsonBody(event, 16 * 1024);
	const conversationId = requiredWebhookString(body, 'conversation_id');
	const businessName = requiredWebhookString(body, 'business_name');
	const location = requiredWebhookString(body, 'location');
	const businessType = requiredWebhookString(body, 'business_type');
	if (!conversationId || !businessName || !location || !businessType) {
		throw apiError(
			400,
			'validation',
			'Fields conversation_id, business_name, location and business_type are required',
		);
	}
	const status = queueVoiceResearch(
		conversationId,
		{ businessName, location, businessType },
		nowMs() + VOICE_RESEARCH_TIMEOUT_MS,
	);
	if (status === 'missing') {
		throw apiError(404, 'not_found', 'Session not found');
	}
	return sendJson(event, 202, { status });
});
