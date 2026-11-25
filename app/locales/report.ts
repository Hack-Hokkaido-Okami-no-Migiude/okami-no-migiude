// Report page copy picker + shared shape. The dictionaries live in
// report-ja.ts / report-en.ts (app/locales/report*); the shape type keeps the
// two files in parity (unit-tested).
import type { Locale } from '#shared/types/domain';

import { reportEn } from './report-en';
import { reportJa } from './report-ja';

export type ReportPageCopy = {
	eyebrow: string;
	loading: string;
	statusLabels: { pending: string; ready: string; failed: string };
	viewingAsStaff: string;
	metaBusinessType: string;
	metaMunicipality: string;
	metaGeneratedAt: string;
	sections: {
		summary: string;
		flow: string;
		currentFlow: string;
		improvedFlow: string;
		bottlenecks: string;
		timeSavings: string;
		workload: string;
		costs: string;
		buildVsBuy: string;
		topics: string;
		nextSteps: string;
	};
	topicObservation: string;
	topicAction: string;
	pendingTitle: string;
	pendingBody: string;
	failedTitle: string;
	failedBody: string;
	failureReasonLabel: string;
	notFoundTitle: string;
	notFoundBody: string;
	unauthorizedTitle: string;
	unauthorizedBody: string;
	goSignIn: string;
	forbiddenTitle: string;
	forbiddenBody: string;
	loadErrorTitle: string;
	loadErrorBody: string;
	refresh: string;
	download: string;
	downloadUnavailable: string;
	showSource: string;
	hideSource: string;
	sourceHeading: string;
	backHome: string;
	consultation: {
		title: string;
		body: string;
		button: string;
		requesting: string;
		requested: string;
		requestedAtLabel: string;
		alreadyNotice: string;
		notReadyNotice: string;
		errorNotice: string;
		note: string;
	};
};

export function reportCopy(locale: Locale): ReportPageCopy {
	return locale === 'en' ? reportEn : reportJa;
}
