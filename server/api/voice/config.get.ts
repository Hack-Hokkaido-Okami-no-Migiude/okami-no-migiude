// GET /api/voice/config — availability flags. `available` covers the full
// voice-session stack (kept for existing conversations); `agentAvailable`
// gates the embedded-agent interview surface; `reportEngineAvailable` says
// whether the Dify post-call assessment can run. No secrets are exposed.
import { defineApi, sendJson } from '../../utils/api';
import {
	agentConfigured,
	difyConfigured,
	voiceConfigured,
} from '../../voice/config';

export default defineApi(async (event) => {
	return sendJson(event, 200, {
		available: voiceConfigured(),
		agentAvailable: agentConfigured(),
		reportEngineAvailable: difyConfigured(),
	});
});
