// GET /api/auth/session — 200 { user: null } without a valid cookie.
import { defineApi, sendJson } from '../../utils/api';
import { getSessionUser } from '../../utils/session';

export default defineApi(async (event) => {
	return sendJson(event, 200, { user: getSessionUser(event) });
});
