// PUT …/sessions/:sessionId/questions/:questionId/answer — record or edit the
// consultant answer on one question (same answer id; the sourceRev increments
// only when the text changes). No analysis is triggered here; a changed answer
// stales discovery and invalidates citations that pointed at the old answer.
import {
	AnswerPutRequestSchema,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StoreLookupError } from '~~/server/store/errors';
import { applyAnswer } from '~~/server/store/answers';
import { commitSessionMutation } from '~~/server/store/commit-session';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, AnswerPutRequestSchema);
		const questionId = requireParam(event, 'questionId');
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			body.baseRev,
			(current) => {
				const previous = current.session.questions.find(
					(question) => question.id === questionId,
				);
				if (!previous) {
					throw new StoreLookupError(
						`Unknown question '${questionId}' for this session.`,
					);
				}
				const applied = applyAnswer(previous, body.text);
				if (!applied.changed) {
					return { session: null };
				}
				const questions = current.session.questions.map((question) =>
					question.id === questionId ? applied.question : question,
				);
				return { session: { ...current.session, questions } };
			},
			{ cascadeCitations: true },
		);
	}),
);
