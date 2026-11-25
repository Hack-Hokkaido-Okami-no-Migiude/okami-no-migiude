// Owner-facing voice chat UI strings. Like the other dictionaries, ja is the
// source of truth and en is typed against it so the two trees cannot drift
// apart. The consent block reuses the shared consent-gate shape from
// interview.ts so InterviewConsentGate can render it.
import type { Locale } from '../../shared/types/domain.ts';
import type { InterviewStrings } from './interview.ts';

const ja = {
	pageTitle: '音声面談 | 女将の右腕',
	eyebrow: '音声面談',
	title: '音声面談（AIエージェント）',
	liveBadge: 'ライブ（AI音声）',
	loading: '音声面談の状態を確認しています…',
	signOutNotice: {
		message:
			'音声面談はオーナー向けの機能です。事業をお持ちのアカウントでサインインしてください。',
		signIn: 'サインインする',
	},
	staffNotice: {
		title: '職員アカウントでは音声面談を開始できません',
		message:
			'音声面談は事業主（オーナー）アカウントのみが利用できます。職員の皆さまは職員用のレポート一覧をご利用ください。',
	},
	unavailable: {
		title: '音声面談は現在利用できません',
		body: 'この環境では音声面談が設定されていません。サンプル面談をご利用いただくか、運営者までお問い合わせください。',
	},
	intro: {
		heading: 'シマエナガと話す音声面談',
		lead: 'AI音声エージェントのシマエナガと約30分ほどお話しいただき、日々の仕事や課題を伺います。お話しいただいた内容は自動で文字起こしされ、保存されます。',
		detailsHeading: '通話で使う登録情報',
		details:
			'通話では、登録済みの以下の情報を参照データとして使います。内容に間違いがあれば、通話の中で口頭で伝えていただければ反映されます。',
		businessLabel: '事業所名',
		locationLabel: '市区町村',
		micHeading: 'マイクと対応ブラウザ',
		mic: 'マイク（音声入力）を使います。開始時にブラウザからマイクの許可を求められます。マイクが使える環境（HTTPS）と対応ブラウザが必要です。',
		processingHeading: 'データの取り扱い',
		processing:
			'音声は通話中にElevenLabsの音声AIサービスで処理されます。通話の文字起こしは保存され、類似事例の調査にはLinkupが使われます。このアプリが録音ファイルを保存・送信することはありません。',
		researchHeading: '通話中の調査について',
		research:
			'通話の裏で、似た事業の事例を自動で調査します。見つかった事例はシマエナガが通話の中で紹介します。',
		nextButton: '同意の確認へ進む',
		previousHeading: '前回の音声面談の記録',
	},
	consent: {
		heading: '同意の確認',
		legend: '確認事項（すべて必須）',
		intro: '音声面談を開始する前に、次のすべてに同意してください。同意は音声面談の開始記録として、開始日時とともに保存されます。',
		items: {
			processing: {
				label: '音声の自動文字起こしと保存に同意します',
				detail: '通話内容は音声AIサービスによって自動的に文字起こしされ、このサービスに保存されます。報告書の自動作成は今後の実装予定で、現時点では行われません。',
			},
			privacy: {
				label: '音声データの扱いに同意します',
				detail: '音声は通話中にElevenLabsの音声AIサービスで処理されます。このアプリが録音ファイルを保存・送信することはありません。類似事例の調査にはLinkupが使われ、事業所名・市区町村・事業種別が使われます。',
			},
			staff: {
				label: '担当職員による参照に同意します',
				detail: '保存された文字起こしと調査結果は、この支援を担当する予定の役所職員が参照することがあります。それ以外の第三者に公開されることはありません。',
			},
		},
		requiredHint:
			'続行するには、3つの確認事項すべてにチェックしてください。',
		startButton: '音声面談を開始する',
		starting: '接続しています…',
	} satisfies InterviewStrings['consent'],
	failures: {
		unsupported:
			'お使いのブラウザでは音声通話を利用できません。マイクに対応したブラウザでお試しください。',
		mic: 'マイクへのアクセスが許可されませんでした。ブラウザの設定を確認して、もう一度お試しください。',
		sdk: '音声クライアントを読み込めませんでした。ページを再読み込みしてお試しください。',
		connection:
			'音声接続を開始できませんでした。しばらく待ってから、もう一度お試しください。',
		switch: '言語切り替えの要求を送信できませんでした。もう一度お試しください。',
		end: '通話を終了できませんでした。もう一度お試しください。',
	},
	errors: {
		network: '通信できませんでした。もう一度お試しください。',
		validation: '入力内容を確認してください。',
		upstream:
			'音声サービスに接続できませんでした。しばらく待ってからもう一度お試しください。',
	},
	research: {
		heading: '類似事例の調査',
		queued: '調査を準備しています…',
		started: '類似事例の調査を開始しました。',
		completed:
			'調査が完了しました（{count}件の事例）。シマエナガが通話の中で紹介します。',
		completedOne:
			'調査が完了しました（1件の事例）。シマエナガが通話の中で紹介します。',
		failed: '調査を完了できませんでした。面談は続けられます。',
		casesHeading: '見つかった事例',
	},
	status: {
		connecting:
			'シマエナガに接続しています。マイクの使用を許可してください。',
		inCall: '通話中',
		ending: '終了しています…',
		ended: '通話が終了しました。文字起こしはこのページに表示されています。',
		saving: '文字起こしを保存しています…',
		saved: '文字起こしを保存しました。',
	},
	controls: {
		end: '通話を終える',
		switchToEnglish: 'Continue in English',
		switchToJapanese: '日本語で続ける',
		switchMessageEn: 'Please continue in English.',
		switchMessageJa: '日本語でお願いします。',
	},
	transcript: {
		heading: '文字起こし',
		empty: 'お話しいただいた内容がここに表示されます。',
		agentLabel: 'シマエナガ',
		userLabel: 'あなた',
	},
	endedActions: {
		backHome: 'ダッシュボードに戻る',
		startAgain: 'もう一度話す',
	},
};

export type VoiceStrings = typeof ja;

const en: VoiceStrings = {
	pageTitle: 'Voice chat | Okami no Migiude',
	eyebrow: 'Voice chat',
	title: 'Voice chat (AI agent)',
	liveBadge: 'Live (AI voice)',
	loading: 'Checking the voice chat state…',
	signOutNotice: {
		message:
			'Voice chat is for business owners. Please sign in with your account.',
		signIn: 'Sign in',
	},
	staffNotice: {
		title: 'Staff accounts cannot start a voice chat',
		message:
			'Voice chat is available to owner accounts only. Staff can use the staff report console.',
	},
	unavailable: {
		title: 'Voice chat is currently unavailable',
		body: 'Voice chat is not configured in this environment. Please use the sample interview or contact the operator.',
	},
	intro: {
		heading: 'A voice chat with Shima Enaga',
		lead: 'Talk with Shima Enaga, the AI voice agent, for about 30 minutes about your daily work and challenges. The conversation is transcribed automatically and stored.',
		detailsHeading: 'Profile details used in the call',
		details:
			'The call uses the following registered details as reference data. Corrections can simply be told to Shima Enaga during the call.',
		businessLabel: 'Business name',
		locationLabel: 'Municipality',
		micHeading: 'Microphone and browser',
		mic: 'The call uses your microphone. Your browser will ask for microphone permission when the call starts. A microphone-capable browser on an HTTPS page is required.',
		processingHeading: 'How your data is handled',
		processing:
			'Your voice is processed live by the ElevenLabs voice AI service. The transcript of the call is stored, and Linkup is used to research similar businesses. This app never records or uploads an audio file.',
		researchHeading: 'Research during the call',
		research:
			'While you talk, examples from similar businesses are researched automatically. Shima Enaga will bring them up during the call.',
		nextButton: 'Continue to consent',
		previousHeading: 'Previous voice chat transcript',
	},
	consent: {
		heading: 'Consent check',
		legend: 'Confirmations (all required)',
		intro: 'Before the voice chat starts, please agree to all of the following. Your consent is recorded with the start date and time.',
		items: {
			processing: {
				label: 'I agree to automatic transcription and storage',
				detail: 'The conversation is transcribed automatically by the voice AI service and stored in this service. Automated report writing is planned for later and does not happen yet.',
			},
			privacy: {
				label: 'I agree to the handling of my voice data',
				detail: 'Your voice is processed live by the ElevenLabs voice AI service. This app never records or uploads an audio file. Linkup is used to research similar businesses, using your business name, municipality and business type.',
			},
			staff: {
				label: 'I agree to staff review',
				detail: 'The stored transcript and research results may be reviewed by the municipal staff responsible for this support. They are not shared with any other third party.',
			},
		},
		requiredHint: 'Please tick all three confirmations to continue.',
		startButton: 'Start the voice chat',
		starting: 'Connecting…',
	} satisfies InterviewStrings['consent'],
	failures: {
		unsupported:
			'This browser cannot make voice calls. Please try a browser with microphone support.',
		mic: 'Microphone access was denied. Please check your browser settings and try again.',
		sdk: 'The voice client could not be loaded. Please reload the page and try again.',
		connection:
			'The voice connection could not be started. Please wait a moment and try again.',
		switch: 'The language switch could not be sent. Please try again.',
		end: 'The call could not be ended. Please try again.',
	},
	errors: {
		network: 'Network error. Please try again.',
		validation: 'Please check your input.',
		upstream:
			'The voice service could not be reached. Please wait a moment and try again.',
	},
	research: {
		heading: 'Research on similar cases',
		queued: 'Preparing the research…',
		started: 'Research on similar cases has started.',
		completed:
			'Research is complete ({count} cases). Shima Enaga will bring them up in the call.',
		completedOne:
			'Research is complete (1 case). Shima Enaga will bring it up in the call.',
		failed: 'The research could not be completed. The chat can continue.',
		casesHeading: 'Cases found',
	},
	status: {
		connecting:
			'Connecting to Shima Enaga. Allow microphone access when prompted.',
		inCall: 'In call',
		ending: 'Ending call…',
		ended: 'The call has ended. The transcript stays on this page.',
		saving: 'Saving the transcript…',
		saved: 'The transcript has been saved.',
	},
	controls: {
		end: 'End call',
		switchToEnglish: 'Continue in English',
		switchToJapanese: '日本語で続ける',
		switchMessageEn: 'Please continue in English.',
		switchMessageJa: '日本語でお願いします。',
	},
	transcript: {
		heading: 'Transcript',
		empty: 'The conversation will appear here as you talk.',
		agentLabel: 'Shima Enaga',
		userLabel: 'You',
	},
	endedActions: {
		backHome: 'Back to the dashboard',
		startAgain: 'Talk again',
	},
};

export const voiceStrings: Record<Locale, VoiceStrings> = { ja, en };
