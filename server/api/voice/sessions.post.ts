// POST /api/voice/sessions — mint a conversation token for the owner's
// ACTIVE live interview. The consolidated interview owns the conversation
// surface, so this endpoint exists only to hand the interview page a
// server-minted token: the agent is private, so the browser cannot fetch
// one from ElevenLabs itself. The minted conversation id is recorded on
// the interview row so the post-call webhook can still associate the
// transcript when the client cannot pass the interview id as a dynamic
// variable. Previously created voice sessions keep working — the post-call
// webhook, the research job and the assessment still process them.
import { defineApi, sendJson } from '../../utils/api';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { requireOwner } from '../../utils/session';
import { nowIso } from '../../utils/clock';
import { agentConfigured, readVoiceConfig } from '../../voice/config';
import {
	createVoiceProviders,
	type VoiceSessionToken,
} from '../../voice/providers';
import {
	findActiveLiveInterview,
	recordInterviewConversation,
} from '../../model/interviews';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	if (!agentConfigured()) {
		throw apiError(
			503,
			'voice_unavailable',
			'Voice chat is not configured on this deployment',
		);
	}
	const interview = findActiveLiveInterview(user.id, nowIso());
	if (!interview) {
		throw apiError(
			409,
			'no_active_interview',
			'No active live interview to mint a conversation for',
		);
	}
	const providers = createVoiceProviders(readVoiceConfig());
	let token: VoiceSessionToken;
	try {
		token = await providers.issueSession();
	} catch (error) {
		console.error('[voice] could not start an ElevenLabs session:', error);
		throw apiError(502, 'upstream', 'Could not start the voice session');
	}
	recordInterviewConversation(interview.id, token.conversationId);
	return sendJson(event, 201, {
		conversationId: token.conversationId,
		conversationToken: token.conversationToken,
	});
});
