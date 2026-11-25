// POST /api/voice/sessions — REJECTED. The consolidated interview owns the
// conversation surface now (the embedded agent on /interview), so this
// endpoint no longer accepts NEW conversations: it answers 410 superseded.
// Existing conversations keep working — the post-call webhook, the research
// job and the assessment still process previously created voice sessions.
import { defineApi, sendJson } from '../../utils/api';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { requireOwner } from '../../utils/session';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	requireOwner(event);
	throw apiError(
		410,
		'superseded',
		'Voice sessions are superseded by the consolidated interview',
	);
});
