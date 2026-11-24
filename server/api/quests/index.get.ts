// The public quest board: the stable summary projection of every published
// quest, with no private joins. A reader without a demo-engineer cookie is
// issued one so a later claim can be attributed to the same browser.
import { PublicQuestSummarySchema } from '~~/shared/shima/schemas';
import { defineEventHandler } from 'h3';
import { issueEngineerCookie } from '~~/server/shima/board';
import { listQuests } from '~~/server/store/repository';
import { runRoute } from '~~/server/utils/http';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const quests = await listQuests();
		issueEngineerCookie(event);
		return quests.map((quest) => PublicQuestSummarySchema.parse({
			id: quest.id,
			rev: quest.rev,
			state: quest.state,
			title: quest.task.title,
			confirmedBudgetYen: quest.task.confirmedBudgetYen,
			targetDate: quest.task.targetDate,
		}));
	}, 'public-quest'),
);
