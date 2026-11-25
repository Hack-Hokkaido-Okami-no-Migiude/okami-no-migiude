// Owner-facing interview UI strings (contract §2: every owner-facing string
// exists in ja and en; no i18n framework — plain locale dictionaries).
// `en` is typed against `typeof ja` so the two locales cannot drift apart.
import type { Locale } from '../../shared/types/domain.ts';

const ja = {
	pageTitle: '面談 | 女将の右腕',
	eyebrow: '面談',
	title: '経営面談',
	loading: '面談の状態を確認しています…',
	signOutNotice: {
		message:
			'面談はオーナー向けの機能です。事業をお持ちのアカウントでサインインしてください。',
		signIn: 'サインインする',
	},
	staffNotice: {
		title: '職員アカウントでは面談を開始できません',
		message:
			'面談は事業主（オーナー）アカウントのみが利用できます。職員の皆さまは職員用のレポート一覧をご利用ください。',
	},
	unavailable: {
		title: '面談の状態を読み込めませんでした',
		body: '通信の問題が発生した可能性があります。時間をおいて再試行してください。',
		retryButton: '再試行',
	},
	intro: {
		heading: '面談について',
		lead: 'この面談では、あなたの事業の現状や課題を整理し、今後の支援につなげるための報告書を作成します。所要は1時間以内、途中で中断しても締め切りまでは再開できます。',
		stepsHeading: '進め方',
		steps: [
			'内容への同意を確認して面談を開始します（開始から1時間が締め切りです）。',
			'サンプル面談を進めるか、ご自身のことばで自由に入力します。',
			'内容を確認して送信すると、報告書の作成が始まります。',
		],
		privacyHeading: 'プライバシーと取り扱い',
		privacy:
			'マイク録音は任意です。録音はブラウザの中だけで行われ、音声がそのまま保存・送信されることはありません。文字起こしは自動では行われないため、送信する文章はご自身で入力・編集します。送信した面談内容と報告書は、あなただけと、この支援を担当する予定の役所職員が参照します。',
		demoHeading: 'サンプル面談について',
		demo: '架空の旅館を題材にしたサンプル面談（台本）をそのまま使えます。台本を送信前に自由に編集できます。',
		nextButton: '同意の確認へ進む',
	},
	consent: {
		heading: '同意の確認',
		legend: '確認事項（すべて必須）',
		intro: '面談を開始する前に、次のすべてに同意してください。同意は面談の開始記録として、開始日時とともに保存されます。',
		items: {
			processing: {
				label: '自動処理による報告書の作成に同意します',
				detail: '送信された面談内容は、自動処理（現在のデモではルールベースの自動下書き）で報告書にまとめられます。内容が人によって読まれる前に、まず自動処理されることをご了承ください。',
			},
			privacy: {
				label: '録音と文字起こしの扱いに同意します',
				detail: 'マイク録音は任意です。録音はこのブラウザの中だけで行われ、音声データは保存も送信もされません（面談の終了、ページを離れる、締め切りの時点で破棄されます）。文字起こしは自動では行われず、送信する文章はご自身で入力・編集します。',
			},
			staff: {
				label: '担当職員による参照に同意します',
				detail: '送信された面談内容と生成された報告書は、あなただけと、この支援を担当する予定の役所職員が参照します。それ以外の第三者に公開されることはありません。',
			},
		},
		requiredHint:
			'続行するには、3つの確認事項すべてにチェックしてください。',
		startButton: '面談を開始する',
		starting: '開始しています…',
	},
	timer: {
		label: '残り時間',
		expired: '終了',
		announcements: {
			remaining_5_minutes: '残り時間は5分です。',
			remaining_1_minute: '残り時間は1分です。',
			remaining_30_seconds: '残り時間は30秒です。',
			remaining_10_seconds: '残り時間は10秒です。',
		},
	},
	demoBadge: 'サンプル面談（フィクション）',
	script: {
		heading: 'サンプル面談を進める',
		note: '台本のやり取りを1行ずつ表示し、表示した内容がそのまま面談記録（文字起こし）に追加されます。内容は架空のものです。送信前に自由に編集できます。',
		personaLabel: '面談相手（架空）',
		progress: '{current} / {total}',
		nextLine: '次のやり取りを表示して記録に追加',
		fillAll: '残りをすべて表示して記録に追加',
		restart: '台本を最初から',
		speechLabel: 'ブラウザの音声で読み上げる（この端末内だけ）',
		speechUnsupported:
			'このブラウザでは音声読み上げを利用できません。文字で確認できます。',
		lineLabel: '現在のやり取り',
		done: '台本はすべて表示済みです。下の面談記録を確認して送信してください。',
	},
	capture: {
		heading: 'マイク録音（任意）',
		note: '録音はこのブラウザの中だけで行われ、音声がそのまま保存・送信されることはありません。文字起こしは自動では行われないため、録音を聞き直しながら、下の入力欄にご自身のことばで記入してください。録音は面談の終了、ページを離れる、締め切りの時点で破棄されます。',
		startButton: '録音を開始',
		stopButton: '録音を停止',
		recordingBadge: '録音中',
		startedAnnouncement: '録音を開始しました。',
		stoppedAnnouncement: '録音を停止しました。',
		requestingAnnouncement: 'マイクの許可を確認しています…',
		reviewLabel: '録音の確認（この画面だけで再生）',
		reviewHint:
			'再生はこの端末の中だけで行われます。締め切りや面談の終了後には録音は破棄されます。',
		clearReview: '録音データを破棄',
		deniedHelp:
			'マイクの使用が許可されていません。ブラウザの設定で許可するか、録音せずに入力だけで面談を進められます。',
		notFoundHelp:
			'マイクが見つからないか、他のアプリで使われています。録音せずに入力だけで面談を進められます。',
		unknownHelp:
			'録音を開始できませんでした。録音せずに入力だけで面談を進められます。',
		unsupportedNote:
			'このブラウザでは録音を利用できません。入力だけで面談を進められます。',
	},
	transcript: {
		heading: '面談記録（送信する内容）',
		label: '面談の内容',
		hint: 'この内容がそのまま送信されます。送信前なら自由に編集できます。',
		placeholder:
			'例）面接者: 現在の状況を教えてください。\n経営者: 従業員2人の小さな店で、後継ぎがいません…',
		restored: '途中まで入力した下書きを復元しました。',
		charCount: '{count} 文字',
		emptyError: '面談の内容が空です。何かご記入ください。',
		tooLongError: '文字数が多すぎます。20万字以内で送信してください。',
		readonlyAfterExpiry: '締め切りを過ぎたため、これ以上編集できません。',
		submitHeading: '内容を確認して送信',
		submitButton: '面談を送信する',
		submitting: '送信しています…',
		submitHint:
			'送信すると報告書の作成が始まります。送信後は編集できません。',
	},
	activeNotice: {
		entered: '面談を開始しました。残り時間にご注意ください。',
		resumed: '面談を再開しました。',
	},
	submitted: {
		heading: '面談を送信しました',
		body: '面談の内容を受け付けました。報告書の作成が始まっています。完成しましたら、ご登録のメールアドレスにお知らせをお送りします。',
		reportLink: '報告書のページを開く',
	},
	expired: {
		heading: '面談の締め切りを過ぎました',
		body: '面談の制限時間（1時間）が経過したため、録音と編集を停止しました。この面談は締め切り済みとして扱われます。入力途中の内容は破棄されます。必要であれば、新しい面談を開始できます。',
		restartButton: '新しい面談を開始する',
	},
	errors: {
		network: '通信に問題が発生しました。時間をおいて再試行してください。',
		internal:
			'予期しない問題が発生しました。時間をおいて再試行してください。',
		unauthorized:
			'サインインの状態が確認できませんでした。ページを再読み込みしてください。',
		forbidden: 'この操作は許可されていません。',
		not_found: '面談が見つかりませんでした。',
		validation: '入力内容を確認してください。',
		interview_active:
			'すでに進行中の面談があります。その面談を再開します。',
		interview_expired: '面談の締め切りを過ぎています。',
		already_submitted: 'この面談はすでに送信済みです。',
		mode_unavailable: 'この面談モードは現在利用できません。',
	},
};

export type InterviewStrings = typeof ja;

const en: InterviewStrings = {
	pageTitle: 'Interview | Okami no Migiude',
	eyebrow: 'Interview',
	title: 'Business interview',
	loading: 'Checking the interview status…',
	signOutNotice: {
		message:
			'The interview is for business owners. Please sign in with the account for your business.',
		signIn: 'Sign in',
	},
	staffNotice: {
		title: 'Staff accounts cannot start an interview',
		message:
			'Only owner accounts can take the interview. Staff can use the staff report list instead.',
	},
	unavailable: {
		title: 'We could not load the interview status',
		body: 'A network problem may have occurred. Please try again in a moment.',
		retryButton: 'Retry',
	},
	intro: {
		heading: 'About the interview',
		lead: 'This interview helps you organize the current state and challenges of your business, and creates a report for future support. It takes at most one hour, and you can resume until the deadline if you stop midway.',
		stepsHeading: 'How it works',
		steps: [
			'Confirm your consent to start the interview (you have one hour from the start).',
			'Play through the sample interview, or write freely in your own words.',
			'Review and submit; report generation then begins.',
		],
		privacyHeading: 'Privacy and handling',
		privacy:
			'Microphone recording is optional. Recording happens only inside your browser; the audio itself is never saved or sent. Transcription is not automatic — you type and edit the text you submit. Your submitted interview content and the report are visible only to you and to the municipal staff designated to support this program.',
		demoHeading: 'About the sample interview',
		demo: 'For accommodation businesses, a scripted sample interview with a fictional inn is available. For other business types, please write your own content in the free-text path. In both cases you can edit everything before submitting.',
		nextButton: 'Go to the consent check',
	},
	consent: {
		heading: 'Consent check',
		legend: 'Acknowledgements (all required)',
		intro: 'Before the interview starts, please agree to all of the following. Your consent is recorded together with the interview start time.',
		items: {
			processing: {
				label: 'I agree that my content is processed automatically to draft a report',
				detail: 'The submitted interview content is summarized into a report by automated processing (a rule-based draft in the current demo). Please be aware that automated processing happens before any person reads it.',
			},
			privacy: {
				label: 'I understand how recording and transcription are handled',
				detail: 'Microphone recording is optional. Recording happens only inside this browser; the audio data is never saved or uploaded (it is discarded when the interview ends, when you leave the page, or at the deadline). Transcription is not automatic — you type and edit the text you submit.',
			},
			staff: {
				label: 'I agree that designated staff can view my content',
				detail: 'Your submitted interview content and the generated report are visible only to you and to the municipal staff designated to support this program. They are not published to any other third party.',
			},
		},
		requiredHint:
			'To continue, please tick all three acknowledgement boxes.',
		startButton: 'Start the interview',
		starting: 'Starting…',
	},
	timer: {
		label: 'Time remaining',
		expired: 'Time is up',
		announcements: {
			remaining_5_minutes: '5 minutes remaining.',
			remaining_1_minute: '1 minute remaining.',
			remaining_30_seconds: '30 seconds remaining.',
			remaining_10_seconds: '10 seconds remaining.',
		},
	},
	demoBadge: 'Sample interview (fictional)',
	script: {
		heading: 'Play the sample interview',
		note: 'The scripted dialogue is revealed line by line, and each revealed line is added to the interview transcript. The content is fictional. You can edit everything before submitting.',
		personaLabel: 'Interview partner (fictional)',
		progress: '{current} / {total}',
		nextLine: 'Show the next exchange and add it to the record',
		fillAll: 'Show the rest and add it all to the record',
		restart: 'Restart the script',
		speechLabel: 'Read aloud with the browser voice (this device only)',
		speechUnsupported:
			'Speech playback is not available in this browser. You can still read the text.',
		lineLabel: 'Current exchange',
		done: 'The whole script has been revealed. Review the record below and submit.',
	},
	capture: {
		heading: 'Microphone recording (optional)',
		note: 'Recording happens only inside this browser; the audio itself is never saved or uploaded. Transcription is not automatic — listen back to your recording and type it into the editor below in your own words. The recording is discarded when the interview ends, when you leave the page, or at the deadline.',
		startButton: 'Start recording',
		stopButton: 'Stop recording',
		recordingBadge: 'Recording',
		startedAnnouncement: 'Recording started.',
		stoppedAnnouncement: 'Recording stopped.',
		requestingAnnouncement: 'Checking microphone permission…',
		reviewLabel: 'Review your recording (plays on this screen only)',
		reviewHint:
			'Playback happens on this device only. The recording is discarded after the deadline or when the interview ends.',
		clearReview: 'Discard the recording data',
		deniedHelp:
			'Microphone access was not allowed. Allow it in your browser settings, or continue with typed input only.',
		notFoundHelp:
			'No microphone was found, or it is in use by another application. You can continue with typed input only.',
		unknownHelp:
			'Recording could not be started. You can continue with typed input only.',
		unsupportedNote:
			'Recording is not available in this browser. You can continue with typed input only.',
	},
	transcript: {
		heading: 'Interview record (what will be submitted)',
		label: 'Interview content',
		hint: 'This text is submitted as-is. You can edit it freely until you submit.',
		placeholder:
			'Example) Interviewer: Please tell us about your current situation.\nOwner: We run a small shop with two employees and no successor…',
		restored: 'Your draft from earlier was restored.',
		charCount: '{count} characters',
		emptyError: 'The interview content is empty. Please write something.',
		tooLongError:
			'The text is too long. Please keep it within 200,000 characters.',
		readonlyAfterExpiry:
			'The deadline has passed, so no further editing is possible.',
		submitHeading: 'Review and submit',
		submitButton: 'Submit the interview',
		submitting: 'Submitting…',
		submitHint:
			'Submitting starts the report generation. The content cannot be edited afterwards.',
	},
	activeNotice: {
		entered:
			'The interview has started. Please keep an eye on the remaining time.',
		resumed: 'The interview has been resumed.',
	},
	submitted: {
		heading: 'Your interview was submitted',
		body: 'Your interview content has been received and report generation has started. You will be notified at your registered email address when the report is ready.',
		reportLink: 'Open the report page',
	},
	expired: {
		heading: 'The interview deadline has passed',
		body: 'The one-hour limit has elapsed, so recording and editing have been stopped. This interview is treated as closed and your draft has been discarded. You can start a new interview if you need to.',
		restartButton: 'Start a new interview',
	},
	errors: {
		network: 'A network problem occurred. Please try again in a moment.',
		internal:
			'An unexpected problem occurred. Please try again in a moment.',
		unauthorized:
			'Your sign-in state could not be confirmed. Please reload the page.',
		forbidden: 'This action is not allowed.',
		not_found: 'The interview was not found.',
		validation: 'Please check your input.',
		interview_active:
			'An interview is already in progress. Resuming that interview.',
		interview_expired: 'The interview deadline has already passed.',
		already_submitted: 'This interview has already been submitted.',
		mode_unavailable: 'This interview mode is currently unavailable.',
	},
};

export const interviewStrings: Record<Locale, InterviewStrings> = { ja, en };
