// GET /api/voice/config — availability flags. `available` covers the full
// voice-session stack (kept for existing conversations); `agentAvailable`
// gates the live interview surface — the agent id, the webhook secret and
// the API key that mints conversation tokens; `reportEngineAvailable` says
// whether the Dify post-call assessment can run. No secrets are exposed.
import { defineApi, sendJson } from '../../utils/api';
import {
	agentConfigured,
	difyConfigured,
	readVoiceConfig,
	voiceConfigured,
} from '../../voice/config';

export default defineApi(async (event) => {
	const config = readVoiceConfig();
	return sendJson(event, 200, {
		available: voiceConfigured(),
		agentAvailable: agentConfigured(),
		reportEngineAvailable: difyConfigured(),
		// The public widget identifier — not a secret; it is embedded in
		// public widget embeds by design. Empty when the agent is unset.
		agentId: agentConfigured() ? config.elevenLabsAgentId : '',
	});
});
