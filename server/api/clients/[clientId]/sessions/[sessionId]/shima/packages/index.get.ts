// The owner's package list for the Shima tracer: one projection row per
// generated package, with staleness recomputed against the current proposal
// basis. Read-only.
import { notFound, requireParam, runRoute } from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { packageProjection } from '~~/server/shima/packages';
import { readShimaView } from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const view = await readShimaView({
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		});
		const session = view.session;
		if (!session) {
			throw notFound('Unknown client or session.');
		}
		return {
			rev: view.section.rev,
			packages: Object.values(view.section.packages).map((pkg) =>
				packageProjection(session, view.keys, pkg),
			),
		};
	}),
);
