// The public quest detail: the exact published task content. No private
// fields, no claim machinery — claims are POST-only with an origin guard.
import { notFound, runRoute } from '~~/server/utils/http';
import { defineEventHandler } from 'h3';
import { publicQuestId } from '~~/server/shima/board';
import { readQuest } from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const questId = publicQuestId(event);
		const quest = await readQuest(questId);
		if (!quest) {
			throw notFound();
		}
		return quest;
	}, 'public-quest'),
);
