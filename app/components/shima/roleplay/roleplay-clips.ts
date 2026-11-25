/**
 * Prerecorded fictional role-play clips for the fixture demo only
 * (SHIMA-PILOT-CONTRACT.md, work order 1). The WAV files are attributed
 * synthetic speech (VOICEVOX Nemo; see public/demo/shima/CREDITS.md and
 * tests/browser/shima-roleplay-script.md). Captions are byte-identical to the
 * verified script and to the text the demo already displays, so playback and
 * text never disagree. Nothing here records, transmits or stores audio, and
 * playback never feeds interview evidence.
 */
export type ShimaRoleplayClipId =
	'intro-owner' | 'question-shima' | 'answer-owner';

export type ShimaRoleplayClip = Readonly<{
	id: ShimaRoleplayClipId;
	/** Exact same-origin static path; no provider, no redirect, no query. */
	src: string;
	/** 録音の話者（架空。VOICEVOX Nemo の声名を明記）。 */
	speaker: string;
	/** Exact spoken text (字幕/文字起こし), always visible in the panel. */
	caption: string;
	/** Visible button labels: 再生 control marks 事前録音・架空. */
	label: string;
	stopLabel: string;
	durationLabel: string;
}>;

export const shimaRoleplayClips: readonly ShimaRoleplayClip[] = [
	{
		id: 'intro-owner',
		src: '/demo/shima/shima-demo-intro-owner.wav',
		speaker: '架空のオーナー（男声1）',
		caption:
			'こんにちは。架空の宿でフロントを担当しています。清掃予定を渡した後に部屋が変わると、電話で連絡して、予定表を書き直しています。',
		label: '導入を再生（事前録音・架空）',
		stopLabel: '導入の再生を停止',
		durationLabel: '約8秒',
	},
	{
		id: 'question-shima',
		src: '/demo/shima/shima-demo-question-shima.wav',
		speaker: 'シマエナガ（女声1・架空）',
		caption:
			'清掃予定を渡した後の部屋変更は、繁忙期に週何回くらいあり、電話と表の書き直しに1回何分くらいかかりますか？',
		label: '質問を再生（事前録音・架空）',
		stopLabel: '質問の再生を停止',
		durationLabel: '約9秒',
	},
	{
		id: 'answer-owner',
		src: '/demo/shima/shima-demo-answer-owner.wav',
		speaker: '架空のオーナー（男声1）',
		caption:
			'繁忙期は週に約10回。電話と予定表の修正に、合わせて1回約15分かかります。',
		label: '回答を再生（事前録音・架空）',
		stopLabel: '回答の再生を停止',
		durationLabel: '約5秒',
	},
] as const;

/** Visible credit required by the VOICEVOX Nemo terms; kept out of <details>. */
export const shimaRoleplayCredit = Object.freeze({
	label: '音声は VOICEVOX Nemo で生成した架空のロールプレイです（実在の録音ではありません）。',
	termsHref: 'https://voicevox.hiroshiba.jp/nemo/term/',
	termsLabel: 'VOICEVOX Nemo の利用規約',
});
