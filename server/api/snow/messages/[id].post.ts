// POST /api/snow/messages/:id — owner only, own messages only.
//   save    — edit the text of a draft (drafts only)
//   approve — the okami approves the (possibly edited) draft
//   send    — send an approved message (never a draft): by email through
//             Resend when configured and the guest has an email address,
//             otherwise to the demo outbox ${DATA_DIR}/guest-outbox
//             (502 delivery_failed keeps it approved for a retry)
//   discard — drop a draft or an approved message that was not sent
import {
	approveMessage,
	discardMessage,
	findMessage,
	saveDraftBody,
	sendMessage,
} from '../../../snow/model';
import { defineApi, parseJsonBody, sendJson } from '../../../utils/api';
import { nowIso, nowMs } from '../../../utils/clock';
import { requireOneOf, requireString } from '../../../utils/validate';
import { apiError } from '../../../utils/errors';
import { assertSameOrigin } from '../../../utils/origin';
import { getRouterParam } from 'h3';
import { requireOwner } from '../../../utils/session';
import { snowPage } from '../../../snow/view';

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const id = getRouterParam(event, 'id') ?? '';
	if (!findMessage(user.id, id)) {
		throw apiError(404, 'not_found', 'Message not found');
	}
	const body = await parseJsonBody(event);
	const action = requireOneOf(body, 'action', [
		'save',
		'approve',
		'send',
		'discard',
	] as const);
	let ok: boolean;
	if (action === 'save' || action === 'approve') {
		if (body.body !== undefined) {
			const text = requireString(body, 'body').trim();
			if (text.length === 0 || text.length > 4000) {
				throw apiError(
					400,
					'validation',
					'Message text must be 1-4000 characters',
				);
			}
			if (!saveDraftBody(user.id, id, text)) {
				throw apiError(
					409,
					'invalid_state',
					'Only drafts can be edited',
				);
			}
		}
		ok = action === 'save' ? true : approveMessage(user.id, id, nowIso());
	} else if (action === 'send') {
		const result = await sendMessage(
			user.id,
			id,
			user.profile.businessName,
			nowIso,
		);
		if (result === 'delivery_failed') {
			throw apiError(
				502,
				'delivery_failed',
				'The email could not be sent; the message is still approved',
			);
		}
		ok = result === 'sent';
	} else {
		ok = discardMessage(user.id, id);
	}
	if (!ok) {
		throw apiError(
			409,
			'invalid_state',
			`Cannot ${action} this message now`,
		);
	}
	return sendJson(event, 200, await snowPage(user, nowMs()));
});
