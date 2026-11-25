// POST /api/snow/guests — owner only: adds one upcoming guest.
import { GUEST_LANGUAGES } from '../../snow/messages';
import { defineApi, parseJsonBody, sendJson } from '../../utils/api';
import {
	optionalString,
	requireOneOf,
	requireString,
} from '../../utils/validate';
import { addGuest } from '../../snow/model';
import { apiError } from '../../utils/errors';
import { assertSameOrigin } from '../../utils/origin';
import { nowIso, nowMs } from '../../utils/clock';
import { requireOwner } from '../../utils/session';
import { snowPage } from '../../snow/view';

function text(value: string | null, max: number): string | null {
	const trimmed = (value ?? '').trim();
	if (trimmed.length > max) {
		throw apiError(400, 'validation', 'A field is too long');
	}
	return trimmed.length > 0 ? trimmed : null;
}

export default defineApi(async (event) => {
	assertSameOrigin(event);
	const user = requireOwner(event);
	const body = await parseJsonBody(event);
	const guestName = text(requireString(body, 'guestName'), 100);
	if (!guestName) {
		throw apiError(400, 'validation', "Field 'guestName' is required");
	}
	const arrivalDate = requireString(body, 'arrivalDate');
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)
		|| Number.isNaN(Date.parse(arrivalDate))
	) {
		throw apiError(
			400,
			'validation',
			"Field 'arrivalDate' must be YYYY-MM-DD",
		);
	}
	const nights = body.nights === undefined ? 1 : Number(body.nights);
	if (!Number.isInteger(nights) || nights < 1 || nights > 60) {
		throw apiError(400, 'validation', "Field 'nights' must be 1-60");
	}
	addGuest(
		user.id,
		{
			guestName,
			guestCountry: text(optionalString(body, 'guestCountry'), 60),
			language: requireOneOf(body, 'language', GUEST_LANGUAGES),
			contact: text(optionalString(body, 'contact'), 200),
			arrivalDate,
			nights,
			arrivesBy: text(optionalString(body, 'arrivesBy'), 60),
			isSample: false,
		},
		nowIso(),
	);
	return sendJson(event, 201, await snowPage(user, nowMs()));
});
