// POST /api/auth/logout — always 200, idempotent (§5).
import {
	clearSessionCookie,
	deleteSessionByToken,
	readSessionToken,
} from '../../utils/session';
import { defineApi, sendJson } from '../../utils/api';
import { assertSameOrigin } from '../../utils/origin';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const token = readSessionToken(event);
	if (token) {
		deleteSessionByToken(token);
	}
	clearSessionCookie(event);
	return sendJson(event, 200, { user: null });
});
