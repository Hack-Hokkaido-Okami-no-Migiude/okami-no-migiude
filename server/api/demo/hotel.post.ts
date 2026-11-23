// POST /api/demo/hotel — idempotent seed: insert the fixture demo when absent,
// otherwise return the existing session without resetting edits. No implicit
// seeding anywhere else.
import { parseJsonBody, runRoute } from '../../utils/http';
import { DemoHotelRequestSchema } from '../../../shared/p0/schemas';
import { defineEventHandler } from 'h3';
import { getOrCreateHotelDemo } from '../../store/repository';
import { hotelSeed } from '../../demo/hotel';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		await parseJsonBody(event, DemoHotelRequestSchema);
		const record = await getOrCreateHotelDemo(hotelSeed);
		return record.session;
	}),
);
