// Record or edit a consultant answer on a question. Answers are first-class
// evidence sources: an edit keeps the same answer id and bumps its `sourceRev`
// only when the text changed, so citations pointing at the answer stay
// addressable and older citations become detectably outdated.
import type { Answer, Question } from '../../shared/p0/types';
import { newId } from './ids';

export function applyAnswer(
	question: Question,
	text: string,
): { question: Question; changed: boolean } {
	const existing = question.answer;
	if (existing && existing.text === text) {
		return { question, changed: false };
	}
	const answer: Answer = existing
		? { id: existing.id, sourceRev: existing.sourceRev + 1, text }
		: { id: newId('ans'), sourceRev: 1, text };
	return {
		question: { ...question, status: 'answered', answer },
		changed: true,
	};
}
