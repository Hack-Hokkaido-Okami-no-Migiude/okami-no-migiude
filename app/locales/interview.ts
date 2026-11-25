// Owner-facing interview UI strings (contract §2: every owner-facing string
// exists in ja and en; no i18n framework — plain locale dictionaries).
// `en` is typed against `typeof ja` so the two locales cannot drift apart.
// The interview is a live conversation with the embedded AI agent (Shima
// Enaga); there is no scripted sample path and no local microphone capture
// in this surface, so no strings exist for either.
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
	// Network/load failure — retryable.
	unavailable: {
		title: '面談の状態を読み込めませんでした',
		body: '通信の問題が発生した可能性があります。時間をおいて再試行してください。',
		retryButton: '再試行',
	},
	// Honest deployment state: the AI agent is not configured here. Nothing
	// is called and no substitute surface is offered.
	agentUnavailable: {
		title: '面談は現在このサイトで利用できません',
		body: '面談用のAIエージェントがまだこの環境に設定されていません。設定が完了するまでお待ちください。音声での面談は行われず、何も送信されません。',
	},
	intro: {
		heading: '面談について',
		lead: 'この面談では、AIエージェント「シマ エナガ」とブラウザ上で音声会話を行い、あなたの事業の現状や課題を整理して、今後の支援につなげるための報告書を作成します。',
		stepsHeading: '進め方',
		steps: [
			'内容への同意を確認して面談を開始します。',
			'シマ エナガとブラウザ上で話します。長さは会話の中で決まりますので、画面に残り時間の表示はありません。',
			'会話が終わると面談の記録が自動で保存され、報告書の作成が始まります。',
		],
		businessHeading: '面談で使う事業の情報',
		businessNote:
			'登録済みの事業情報を使って、エージェントはあなたの事業に合わせた質問をします。内容が違う場合は、会話の中で直接教えてください。あなたのことばが最優先です。',
		businessLabel: '事業名',
		locationLabel: '所在地',
		processingHeading: '面談の記録と報告書',
		processing:
			'会話はAI音声サービスを通じて行われ、発話は文字起こしされます。文字起こし結果（面談の記録）はこのサービスのサーバーに保存され、AIによる自動処理で報告書の下書きがまとめられます。作成状況はこのページで確認でき、完成しましたらご登録のメールアドレスにもお知らせします。',
		researchHeading: '調査データの活用',
		research:
			'面談の進行に合わせて、あなたの事業と同じ地域・業種の取り組み事例を自動で調査し、会話の中で比較材料として使うことがあります。調査は自動で行われ、あなたが何かを入力する必要はありません。',
		nextButton: '同意の確認へ進む',
	},
	consent: {
		heading: '同意の確認',
		legend: '確認事項（すべて必須）',
		intro: '面談を開始する前に、次のすべてに同意してください。同意は面談の開始記録として、開始日時とともに保存されます。すべてに同意するまで、音声会話は始まりません。',
		items: {
			processing: {
				label: '自動処理による報告書の作成に同意します',
				detail: '保存された面談の記録は、人によって読まれる前に自動処理され、報告書の下書きとしてまとめられます。',
			},
			privacy: {
				label: 'AI音声での面談と文字起こしの扱いに同意します',
				detail: '面談はAIエージェントとの音声会話で行われます。マイクの音声は会話の処理と文字起こしのためにAI音声サービスに送信されます。文字起こし結果（面談の記録）はこのサービスのサーバーに保存され、報告書の作成に使われます。このページに残り時間の表示はなく、会話の長さはエージェントが管理します。',
			},
			staff: {
				label: '担当職員による参照に同意します',
				detail: '保存された面談の記録と生成された報告書は、あなただけと、この支援を担当する予定の役所職員が参照します。それ以外の第三者に公開されることはありません。',
			},
		},
		requiredHint:
			'続行するには、3つの確認事項すべてにチェックしてください。',
		startButton: '面談を開始する',
		starting: '開始しています…',
	},
	live: {
		agentName: 'シマ エナガ',
		entering: '面談を開始しました。シマ エナガがまもなく話しかけます。',
		resumed: '進行中の面談を再開しました。',
		inCall: 'シマ エナガと話しています。終えるときは、ウィジェットの終了ボタンを使うか、下の「面談を終了する」を選んでください。',
		endButton: '面談を終了する',
		ending: '終了しています…',
		ended: '面談を終了しました。記録の保存を確認しています。このページを離れても、記録は自動で保存されます。',
		backHome: 'ホームに戻る',
		checkAgain: '面談の状態をもう一度確認する',
	},
	research: {
		heading: '調査データ',
		queued: '面談の開始時に調査を開始します。',
		started: '取り組み事例を調査しています…',
		completedOne:
			'取り組み事例を1件調査しました。会話の中で比較材料として使われます。',
		completed:
			'取り組み事例を{count}件調査しました。会話の中で比較材料として使われます。',
		failed: '調査は利用できませんでした。面談はあなたのことばだけで進めます。',
		notConnected:
			'調査はこの面談では利用できません。面談はあなたのことばだけで進めます。',
		caseLabel: '調査した取り組み事例',
	},
	assessment: {
		preparing:
			'報告書を作成しています。完成しましたら、ご登録のメールアドレスにお知らせします。',
		unavailable:
			'報告書の自動作成がこの環境で利用できないため、報告書は作成されません。面談の記録は保存されています。担当職員に直接ご相談ください。',
		failed: '報告書の作成に失敗しました。面談の記録は保存されています。時間をおいて再度確認するか、担当職員に直接ご相談ください。',
	},
	demoActive: {
		title: '面談が進行中です',
		body: 'この面談はシステムからの確認用に開始されたもので、このページからは操作できません。しばらくしてからもう一度このページを開いてください。',
	},
	submitted: {
		heading: '面談を送信しました',
		body: '面談の記録を受け付けました。報告書の作成が始まっています。完成しましたら、ご登録のメールアドレスにお知らせをお送りします。',
		reportLink: '報告書のページを開く',
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
	agentUnavailable: {
		title: 'The interview is not available on this site right now',
		body: 'The AI agent for interviews has not been configured for this environment yet. Please wait until the setup is complete. No voice conversation is started and nothing is submitted.',
	},
	intro: {
		heading: 'About the interview',
		lead: 'In this interview you talk with the AI agent “Shima Enaga” in the browser about the current state and challenges of your business, and a report is created for future support.',
		stepsHeading: 'How it works',
		steps: [
			'Confirm your consent to start the interview.',
			'Talk with Shima Enaga in the browser. The agent manages the length of the conversation, so the page shows no timer.',
			'When the conversation ends, the interview record is saved automatically and report preparation begins.',
		],
		businessHeading: 'Business information used in the interview',
		businessNote:
			'The agent asks questions tailored to your business using your registered business information. If something is wrong, tell the agent directly in the conversation — your own words always take precedence.',
		businessLabel: 'Business name',
		locationLabel: 'Location',
		processingHeading: 'Interview record and report',
		processing:
			'The conversation runs through an AI voice service, and what you say is transcribed. The transcript (the interview record) is stored on this service’s server, and automated processing drafts the report from it. You can follow the progress on this page, and we will notify your registered email address when the report is ready.',
		researchHeading: 'Research data',
		research:
			'During the interview, initiatives in the same region and industry as your business are researched automatically and may be used in the conversation as material for comparison. The research runs by itself; you never have to enter anything.',
		nextButton: 'Go to the consent check',
	},
	consent: {
		heading: 'Consent check',
		legend: 'Acknowledgements (all required)',
		intro: 'Before the interview starts, please agree to all of the following. Your consent is recorded together with the interview start time. The voice conversation does not begin until every item is agreed.',
		items: {
			processing: {
				label: 'I agree that my content is processed automatically to draft a report',
				detail: 'The saved interview record is processed automatically — before any person reads it — and summarized into a report draft.',
			},
			privacy: {
				label: 'I understand how the AI voice conversation and transcription are handled',
				detail: 'The interview is a voice conversation with an AI agent. Your microphone audio is sent to the AI voice service for conversation processing and transcription. The transcript (the interview record) is stored on this service’s server and used to prepare the report. The page shows no timer; the agent manages the length of the conversation.',
			},
			staff: {
				label: 'I agree that designated staff can view my content',
				detail: 'The saved interview record and the generated report are visible only to you and to the municipal staff designated to support this program. They are not published to any other third party.',
			},
		},
		requiredHint:
			'To continue, please tick all three acknowledgement boxes.',
		startButton: 'Start the interview',
		starting: 'Starting…',
	},
	live: {
		agentName: 'Shima Enaga',
		entering:
			'The interview has started. Shima Enaga will speak to you shortly.',
		resumed: 'The interview in progress has been resumed.',
		inCall: 'You are talking with Shima Enaga. When you are done, use the widget’s end button or choose “End the interview” below.',
		endButton: 'End the interview',
		ending: 'Ending…',
		ended: 'The interview has ended. We are waiting for the record to be saved. You can leave this page; the record is saved automatically either way.',
		backHome: 'Back to home',
		checkAgain: 'Check the interview status again',
	},
	research: {
		heading: 'Research data',
		queued: 'Research starts when the interview begins.',
		started: 'Researching initiatives…',
		completedOne:
			'One initiative was researched. It is used in the conversation as material for comparison.',
		completed:
			'{count} initiatives were researched. They are used in the conversation as material for comparison.',
		failed: 'The research was unavailable. The interview continues with your own words only.',
		notConnected:
			'Research is not available for this interview. The interview continues with your own words only.',
		caseLabel: 'Researched initiatives',
	},
	assessment: {
		preparing:
			'The report is being prepared. We will notify your registered email address when it is ready.',
		unavailable:
			'Automated report preparation is not available in this environment, so no report is created. Your interview record is saved. Please consult the designated staff directly.',
		failed: 'Report preparation failed. Your interview record is saved. Please check again later or consult the designated staff directly.',
	},
	demoActive: {
		title: 'An interview is in progress',
		body: 'This interview was started by the system for verification and cannot be driven from this page. Please open this page again later.',
	},
	submitted: {
		heading: 'Your interview was submitted',
		body: 'Your interview record has been received and report preparation has started. You will be notified at your registered email address when the report is ready.',
		reportLink: 'Open the report page',
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
