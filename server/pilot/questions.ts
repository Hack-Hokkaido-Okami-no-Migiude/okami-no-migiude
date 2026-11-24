import type { Question } from '../../shared/p0/types';

export const INTERVIEW_TOPICS = ['routine', 'manual-effort', 'tools', 'exceptions', 'goals'] as const;
export type InterviewTopic = (typeof INTERVIEW_TOPICS)[number];

/** Project only from the latest committed analysis; never take a gap from the browser. */
export type InterviewGap = Readonly<Pick<Question, 'id' | 'priority' | 'status' | 'answer'> & { factKey: string }>;
export type InterviewQuestion = Readonly<{ id: string; text: string }>;
export type SelectedQuestion = Readonly<{ question: InterviewQuestion; speechId: string }>;

const agenda: Record<InterviewTopic, string> = {
	routine: 'ふだんの仕事は、何から始めて、どんな順番で進めますか？',
	'manual-effort': '手作業で時間がかかるのは、どの作業ですか？',
	tools: 'ふだんの作業では、どんな道具やシステムを使いますか？',
	exceptions: 'いつもの手順で進められないときは、どう対応しますか？',
	goals: '仕事の進め方で、まず何を改善したいですか？',
};

const followUps = new Map([
	['trigger', 'その作業は、どんなきっかけで始まりますか？'],
	['actor', 'その作業は、どの役割の人が担当しますか？'],
	['tool', 'その作業には、どんな道具やシステムを使いますか？'],
	['handoff', 'その作業の結果は、次にどの役割の人に渡しますか？'],
	['branch-rule', '手順が変わるときは、何を基準に判断しますか？'],
	['exception', 'いつもの手順で進められない場合、どう対応しますか？'],
	['frequency', 'その作業は、ふだんどのくらいの頻度で発生しますか？'],
	['minutes', 'その作業には、1回あたり何分くらいかかりますか？'],
	['integration', 'その作業では、使っているシステム同士で情報をどうやり取りしますか？'],
	['risk', 'その作業で、特に気をつけていることは何ですか？'],
]);
const genericFollowUp = 'その作業について、まだ話していない点があれば教えてください。';
const priorities = ['high', 'medium', 'low'] as const;

/** Select one prompt. A gap supplies identity and a semantic key, never spoken prose. */
export function selectInterviewQuestion(
	gaps: readonly InterviewGap[],
	asked: ReadonlySet<string>,
	topic?: InterviewTopic,
): SelectedQuestion | null {
	if (topic !== undefined) {
		return INTERVIEW_TOPICS.includes(topic) ? agendaQuestion(topic) : null;
	}
	let best: InterviewGap | undefined;
	let rank = priorities.length as number;
	for (const gap of gaps) {
		if (gap.status !== 'open' || gap.answer !== null || asked.has(gap.id)
			|| !/^q_[A-Za-z0-9_.:-]{1,126}$/.test(gap.id)) {continue;}
		const priority = priorities.indexOf(gap.priority);
		if (priority < 0 || priority >= rank) {continue;}
		best = gap;
		rank = priority;
		if (rank === 0) {break;}
	}
	if (best) {
		const approved = followUps.get(best.factKey);
		return {
			question: { id: best.id, text: approved ?? genericFollowUp },
			speechId: approved === undefined ? 'gap:generic' : `gap:${best.factKey}`,
		};
	}
	const next = INTERVIEW_TOPICS.find(item => !asked.has(`interview:${item}`));
	return next === undefined ? null : agendaQuestion(next);
}

function agendaQuestion(topic: InterviewTopic): SelectedQuestion {
	const id = `interview:${topic}`;
	return { question: { id, text: agenda[topic] }, speechId: id };
}
