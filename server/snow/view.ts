// Shapes the snow-day page data for the owner (GET /api/snow and the
// responses of the snow POST routes).
import { SNOW_KINDS, checkSnow } from './jma';
import type { SnowCheck } from './jma';
import { draftBody } from './messages';
import { deliveryFor, innDate, listArrivals, listMessagesFor } from './model';
import type { MessageRow, ReservationRow } from './model';
import type { OwnerProfile } from '#shared/types/domain';

export function innInfo(profile: OwnerProfile) {
	return { innName: profile.businessName, innPhone: profile.phone };
}

function messageView(
	message: MessageRow,
	guest: ReservationRow,
	profile: OwnerProfile,
) {
	const vars = {
		guestName: guest.guest_name,
		...innInfo(profile),
		arrivalDate: guest.arrival_date,
		warningCode: message.warning_code,
	};
	const kind = SNOW_KINDS[message.warning_code];
	return {
		id: message.id,
		status: message.status,
		language: message.language,
		body: message.body,
		trigger: message.trigger,
		warningCode: message.warning_code,
		warningNameJa: kind?.nameJa ?? '',
		warningNameEn: kind?.nameEn ?? '',
		createdAt: message.created_at,
		approvedAt: message.approved_at,
		sentAt: message.sent_at,
		// How it went out (once sent), or where it would go if sent now.
		channel: message.channel,
		deliveryChannel: deliveryFor(guest.contact).channel,
		// What the original draft says, in the okami's own language.
		glossJa: message.language === 'ja' ? null : draftBody(vars, 'ja'),
		glossEn: message.language === 'en' ? null : draftBody(vars, 'en'),
	};
}

function weatherView(check: SnowCheck) {
	if (check.status === 'ok') {
		return {
			status: check.status,
			active: check.active,
			reportDatetime: check.reportDatetime,
		};
	}
	return { status: check.status, active: [], reportDatetime: null };
}

export async function snowPage(
	user: { id: string; profile: OwnerProfile },
	nowMs: number,
) {
	const today = innDate(nowMs);
	const tomorrow = innDate(nowMs, 1);
	const check = await checkSnow(user.profile.municipality, nowMs);
	const guests = listArrivals(user.id, today, tomorrow);
	const messages = listMessagesFor(
		user.id,
		guests.map((guest) => guest.id),
	);
	return {
		today,
		tomorrow,
		municipality: user.profile.municipality,
		area: check.status === 'unknown_area' ? null : check.area,
		weather: weatherView(check),
		guests: guests.map((guest) => {
			const message = messages.find((m) => m.reservation_id === guest.id);
			return {
				id: guest.id,
				guestName: guest.guest_name,
				guestCountry: guest.guest_country,
				language: guest.language,
				contact: guest.contact,
				arrivalDate: guest.arrival_date,
				nights: guest.nights,
				arrivesBy: guest.arrives_by,
				isSample: guest.is_sample === 1,
				message:
					message ? messageView(message, guest, user.profile) : null,
			};
		}),
	};
}
