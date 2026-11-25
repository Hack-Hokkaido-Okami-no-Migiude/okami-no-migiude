// Fictional scripted demo interview (contract §11): a fixed persona and Q&A
// flow shipped as static app data. Everything here is fictional; the UI must
// keep the persistent fictional label visible. Speaker labels follow the
// transcript conventions used by the rule-based analyzer
// (ja: 面接者/経営者, en: Interviewer/Owner).
import type { Locale } from '../../shared/types/domain.ts';
import type { ScriptLine } from '../utils/interview-transcript.ts';

export type InterviewScriptData = {
	/** Fictional business the script pretends to interview. */
	personaName: string;
	/** Persistent fictional label, e.g. 「サンプル面談（フィクション）」. */
	fictionalLabel: string;
	/** One-paragraph disclaimer shown with the script. */
	disclaimer: string;
	speakerLabels: { interviewer: string; owner: string };
	lines: ScriptLine[];
};

const ja: InterviewScriptData = {
	personaName: 'しらとり温泉 やまなみ荘',
	fictionalLabel: 'サンプル面談（フィクション）',
	disclaimer:
		'これは架空の小規模旅館「しらとり温泉 やまなみ荘」を題材にしたサンプル面談です。実在の事業者・団体・出来事とは一切関係ありません。内容は自動生成ではなく固定の台本です。',
	speakerLabels: { interviewer: '面接者', owner: '経営者' },
	lines: [
		{
			speaker: 'interviewer',
			text: 'こんにちは。本日はよろしくお願いします。まず、やまなみ荘の現在の状況を教えてください。',
		},
		{
			speaker: 'owner',
			text: 'はい。しらとり温泉のやまなみ荘です。客室8室の小さな温泉旅館で、妻と私と、パートの従業員2人で回しています。',
		},
		{
			speaker: 'interviewer',
			text: '直近の経営で特に課題に感じていることは何ですか。',
		},
		{
			speaker: 'owner',
			text: '何よりも人手不足です。清掃と朝食担当のパートさんが採用できず、繁忙期は家族総出で働いています。',
		},
		{
			speaker: 'interviewer',
			text: '繁忙期と閑散期の差はどのくらいですか。',
		},
		{
			speaker: 'owner',
			text: '12月から2月はスキー客でほぼ満室ですが、6月の平日は客室稼働率が2割まで落ちます。季節による差が大きいです。',
		},
		{
			speaker: 'interviewer',
			text: 'お客さまはどのような経路で来られますか。',
		},
		{
			speaker: 'owner',
			text: 'リピーターと口コミが7割で、予約は電話が中心です。Web予約はまだ用意できていません。',
		},
		{
			speaker: 'interviewer',
			text: '客単価や料金の見直しについてはいかがですか。',
		},
		{
			speaker: 'owner',
			text: '一泊二食で1人1万円台後半です。近隣と比べると割安なのですが、値上げにはどうしても不安があります。',
		},
		{
			speaker: 'interviewer',
			text: '設備やサービスで、投資が必要だと感じている部分はありますか。',
		},
		{
			speaker: 'owner',
			text: '給湯ボイラーが古くて修繕費がかさむことと、玄関にスロープがなく車いすのお客さまへ対応しきれないことです。',
		},
		{
			speaker: 'interviewer',
			text: '事業の承継についてお考えはありますか。',
		},
		{
			speaker: 'owner',
			text: '長男が県外で働いていて、戻ってくるかどうか分かりません。いずれは誰かに引き継ぎたいと思っています。',
		},
		{
			speaker: 'interviewer',
			text: '役所の制度や補助金を利用したことはありますか。',
		},
		{
			speaker: 'owner',
			text: '2年前に小規模事業者持続化補助金を使いました。ただ、申請書類の作成はとても大変でした。',
		},
		{
			speaker: 'interviewer',
			text: '今後1年で取り組みたいことは何ですか。',
		},
		{
			speaker: 'owner',
			text: 'Web予約を入れることと、閑散期向けの平日プランを作ることです。人手が足りれば、という条件付きですが。',
		},
		{
			speaker: 'interviewer',
			text: '本日はありがとうございました。お話しいただいた内容は報告書にまとめられます。',
		},
		{
			speaker: 'owner',
			text: 'ありがとうございます。よろしくお願いします。',
		},
	],
};

const en: InterviewScriptData = {
	personaName: 'Yamaminami-so, Shiratori Onsen',
	fictionalLabel: 'Sample interview (fictional)',
	disclaimer:
		'This is a scripted sample interview featuring the fictional small inn "Yamaminami-so, Shiratori Onsen". It does not depict any real business, organization, or event, and the dialogue is fixed script content, not generated.',
	speakerLabels: { interviewer: 'Interviewer', owner: 'Owner' },
	lines: [
		{
			speaker: 'interviewer',
			text: 'Hello, and thank you for your time. Could you start by telling us about your inn?',
		},
		{
			speaker: 'owner',
			text: 'Of course. Yamaminami-so is a small hot-spring inn in Shiratori with eight rooms. My wife, our two part-time staff, and I run it together.',
		},
		{
			speaker: 'interviewer',
			text: 'What is the biggest challenge in running the business right now?',
		},
		{
			speaker: 'owner',
			text: 'Staffing, above all. We cannot hire part-time staff for cleaning and breakfast service, so the whole family works through the busy season.',
		},
		{
			speaker: 'interviewer',
			text: 'How large is the gap between the busy and the quiet seasons?',
		},
		{
			speaker: 'owner',
			text: 'From December to February ski guests fill almost every room, but on summer weekdays in June the room occupancy drops to about twenty percent.',
		},
		{
			speaker: 'interviewer',
			text: 'How do your guests find you?',
		},
		{
			speaker: 'owner',
			text: 'Seven out of ten come from repeat visits and word of mouth. Reservations are mostly by phone; we do not have online booking yet.',
		},
		{
			speaker: 'interviewer',
			text: 'How do you feel about your rates and pricing?',
		},
		{
			speaker: 'owner',
			text: 'A one-night stay with two meals is in the high ten-thousand yen range per person. We are cheaper than nearby inns, but raising prices still makes me anxious.',
		},
		{
			speaker: 'interviewer',
			text: 'Is there any equipment or service where you feel investment is needed?',
		},
		{
			speaker: 'owner',
			text: 'The hot-water boiler is old and repairs are costly, and the entrance has no ramp, so we cannot fully welcome guests who use wheelchairs.',
		},
		{
			speaker: 'interviewer',
			text: 'Have you thought about the succession of the business?',
		},
		{
			speaker: 'owner',
			text: 'Our eldest son works outside the prefecture, so I do not know whether he will come back. Still, I would like to hand the inn over to someone someday.',
		},
		{
			speaker: 'interviewer',
			text: 'Have you used municipal programs or subsidies?',
		},
		{
			speaker: 'owner',
			text: 'We used the small business sustainability subsidy two years ago. Preparing the paperwork was very hard, though.',
		},
		{
			speaker: 'interviewer',
			text: 'What would you like to work on in the coming year?',
		},
		{
			speaker: 'owner',
			text: 'Adding online booking, and creating weekday plans for the quiet season — as long as we can find the staff to run them.',
		},
		{
			speaker: 'interviewer',
			text: 'Thank you very much. What you shared today will be summarized in a report.',
		},
		{
			speaker: 'owner',
			text: 'Thank you as well. We appreciate your support.',
		},
	],
};

export const interviewScript: Record<Locale, InterviewScriptData> = {
	ja,
	en,
};
