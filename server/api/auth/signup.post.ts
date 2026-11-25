// POST /api/auth/signup — owner self-registration (§5).
import {
	createOwnerUser,
	findUserByEmail,
	loadSessionUserById,
} from '../../model/users';
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { createSession } from '../../utils/session';
import { parseSignup } from '../../utils/signup';
import { staffEmails } from '../../utils/env';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const signup = parseSignup(await parseJsonBody(event));
	if (findUserByEmail(signup.email) || staffEmails().includes(signup.email)) {
		throw apiError(409, 'email_taken', 'This email cannot be registered');
	}
	const userId = createOwnerUser(signup);
	createSession(event, userId);
	return sendJson(event, 201, { user: loadSessionUserById(userId) });
});
