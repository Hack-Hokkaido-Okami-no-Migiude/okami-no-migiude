// English UI copy for the report page (viewer's app locale — the report
// content itself follows the report's snapshot locale). Keep keys in parity
// with report-ja.ts; a unit test asserts the key structures stay identical.
import type { ReportPageCopy } from './report';

export const reportEn: ReportPageCopy = {
	eyebrow: 'Business consultation report',
	loading: 'Loading…',
	statusLabels: {
		pending: 'Preparing',
		ready: 'Ready',
		failed: 'Failed',
	},
	viewingAsStaff: 'Viewing as staff',
	metaMunicipality: 'Municipality',
	metaGeneratedAt: 'Generated at',
	sections: {
		summary: 'Summary',
		flow: 'Current and improved flow',
		currentFlow: 'Current flow',
		improvedFlow: 'Improved flow',
		bottlenecks: 'Bottlenecks',
		timeSavings: 'Time savings and assumptions',
		workload: 'Implementation workload',
		costs: 'Indicative costs',
		buildVsBuy: 'Off-the-shelf or custom',
		topics: 'Topic-by-topic review',
		nextSteps: 'Next steps',
	},
	topicObservation: 'Observation',
	topicAction: 'Recommended action',
	pendingTitle: 'Preparing your report',
	pendingBody: 'This page switches automatically when the report is ready.',
	failedTitle: 'Report generation failed',
	failedBody:
		'Please restart the interview or contact the support desk at the municipal office.',
	failureReasonLabel: 'Error details',
	notFoundTitle: 'Report not found',
	notFoundBody: 'The report does not exist or is not accessible.',
	unauthorizedTitle: 'Sign-in required',
	unauthorizedBody: 'Sign in to view the report.',
	goSignIn: 'Go to sign-in',
	forbiddenTitle: 'No access',
	forbiddenBody: 'You do not have access to this report.',
	loadErrorTitle: 'Failed to load',
	loadErrorBody: 'Please try again in a moment.',
	refresh: 'Reload',
	download: 'Download report (Markdown)',
	downloadUnavailable:
		'The download becomes available once the report is ready.',
	showSource: 'Show original text',
	hideSource: 'Hide original text',
	sourceHeading: 'Original text (Markdown)',
	backHome: 'Back to home',
	consultation: {
		title: 'Consultation follow-up',
		body: 'Request a follow-up at the support desk about the contents of this report.',
		button: 'Request consultation',
		requesting: 'Sending…',
		requested: 'Consultation request: done',
		requestedAtLabel: 'Requested at',
		alreadyNotice: 'A consultation request is already recorded.',
		notReadyNotice:
			'The consultation request becomes available once the report is ready.',
		errorNotice: 'The request failed. Please try again in a moment.',
		note: 'The request is shared with staff (record only in this version).',
	},
};
