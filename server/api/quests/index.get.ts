// The public quest board: the stable summary projection of every published
// quest, with no private joins. A reader without a demo-engineer cookie is
// issued one so a later claim can be attributed to the same browser.
import { defineEventHandler, getHeader, setCookie } from 'h3';
import { listQuests } from '~~/server/store/repository';
import { randomUUID } from 'node:crypto';
import { runRoute } from '~~/server/utils/http';
import { z } from 'zod';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const quests = await listQuests();
		const cookie = getHeader(event, 'cookie') ?? '';
		const match = /(?:^|;\s*)shima_engineer=([^;]+)/.exec(cookie);
		const value = match?.[1] ?? '';
		if (!z.string().uuid().safeParse(value).success) {
			setCookie(event, 'shima_engineer', randomUUID(), {
				path: '/',
				sameSite: 'lax',
				httpOnly: true,
				maxAge: 60 * 60 * 24 * 365,
			});
		}
		return quests.map((quest) => ({
			id: quest.id,
			rev: quest.rev,
			state: quest.state,
			title: quest.task.title,
			confirmedBudgetYen: quest.task.confirmedBudgetYen,
			targetDate: quest.task.targetDate,
		}));
	}),
);
