// GET /api/voice/config — availability flag for the dashboard button and the
// voice page's honest unavailable state. No secrets are exposed.
import { defineApi, sendJson } from '../../utils/api';
import { voiceConfigured } from '../../voice/config';

export default defineApi(async (event) => {
	return sendJson(event, 200, { available: voiceConfigured() });
});
