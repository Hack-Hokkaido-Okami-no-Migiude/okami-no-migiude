// The owner's Hear→Map view for the Shima tracer: discovery staleness, the
// documented gaps, per-step owner-reported effort, and the fresh proposal
// picture — all read-only, fail-closed on unknown sessions.
import { notFound, requireParam, runRoute } from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { readShimaView } from '~~/server/store/repository';
import { shimaMapView } from '~~/server/shima/map';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const view = await readShimaView({
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		});
		if (!view.session) {
			throw notFound('Unknown client or session.');
		}
		return shimaMapView(view.session, view.section);
	}),
);
