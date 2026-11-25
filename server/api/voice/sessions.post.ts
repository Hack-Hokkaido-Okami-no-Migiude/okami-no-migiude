// POST /api/voice/sessions — start a live voice chat for the signed-in owner.
// Voice sessions are conversation only: the session row records consent, the
// profile-derived business intake and the research/transcript lifecycle. No
// interview or report rows are created.
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { inTransaction } from '../../utils/db';
import { nowIso, nowMs } from '../../utils/clock';
import { requireOwner } from '../../utils/session';
import { readVoiceConfig, voiceConfigured } from '../../voice/config';
import {
	createVoiceProviders,
	type VoiceBusiness,
	type VoiceSessionToken,
} from '../../voice/providers';
import {
	insertVoiceSession,
	supersedePendingVoiceSessions,
} from '../../voice/model';
import { VOICE_RESEARCH_TIMEOUT_MS } from '../../voice/jobs';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	if (!voiceConfigured()) {
		throw apiError(
			503,
			'voice_unavailable',
			'Voice chat is not configured on this deployment',
		);
	}
	const body = await parseJsonBody(event);
	if (body.consent !== true) {
		throw apiError(
			400,
			'validation',
			"Field 'consent' must be exactly the boolean true",
		);
	}
	const profile = user.profile;
	const businessName = profile.businessName.trim();
	const municipality = profile.municipality.trim();
	if (!businessName || !municipality) {
		throw apiError(
			400,
			'validation',
			'Owner profile is missing business details',
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
	const now = nowIso();
	const business: VoiceBusiness = {
		businessName,
		location: municipality,
	};
	inTransaction((db) => {
		insertVoiceSession(db, {
			conversationId: token.conversationId,
			ownerId: user.id,
			consentAt: now,
			reportLanguage: profile.locale,
			business,
			researchDeadline: nowMs() + VOICE_RESEARCH_TIMEOUT_MS,
			createdAt: now,
		});
		// Abandoned calls must not keep polling research forever.
		supersedePendingVoiceSessions(db, user.id, token.conversationId);
	});
	return sendJson(event, 201, {
		conversationId: token.conversationId,
		conversationToken: token.conversationToken,
	});
});
