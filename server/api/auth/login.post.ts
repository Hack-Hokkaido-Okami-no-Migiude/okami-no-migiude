// POST /api/auth/login — identical errors for unknown email and wrong
// password (no account enumeration).
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import { findUserByEmail, loadSessionUserById } from '../../model/users';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { createSession } from '../../utils/session';
import { requireString } from '../../utils/validate';
import { verifyPassword } from '../../utils/password';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const body = await parseJsonBody(event);
	const email = requireString(body, 'email').trim().toLowerCase();
	const password = requireString(body, 'password');
	const user = findUserByEmail(email);
	if (!user || !verifyPassword(password, user.password_hash)) {
		throw apiError(
			401,
			'invalid_credentials',
			'Email or password is incorrect',
		);
	}
	createSession(event, user.id);
	return sendJson(event, 200, { user: loadSessionUserById(user.id) });
});
