// The public quest detail: the exact published task content. No private
// fields, no claim machinery — claims are POST-only with an origin guard.
import { notFound, requireParam, runRoute } from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { readQuest } from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const questId = requireParam(event, 'questId');
		const quest = await readQuest(questId);
		if (!quest) {
			throw notFound(`Unknown quest '${questId}'.`);
		}
		return { id: quest.id, rev: quest.rev, state: quest.state, task: quest.task };
	}),
);
