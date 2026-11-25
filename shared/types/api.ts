// API wire payload types (contract §4). Type-only module.
import type {
	BusinessType,
	InterviewCurrent,
	InterviewMode,
	Locale,
	Report,
	SessionUser,
	StaffReportSummary,
} from './domain';

export type SignupRequest = {
	email: string;
	password: string;
	profile: {
		name: string;
		businessName: string;
		businessType: BusinessType;
		otherBusinessType?: string; // required iff businessType === 'other'
		municipality: string;
		phone?: string;
		website?: string;
		note?: string;
		locale: Locale;
	};
};

export type LoginRequest = { email: string; password: string };

export type SessionResponse = { user: SessionUser | null };

export type InterviewStartRequest = { consent: true; mode: InterviewMode };

export type InterviewStartResponse = { interview: InterviewCurrent };

export type InterviewCompleteRequest = { transcript: string };

export type InterviewCompleteResponse = {
	interview: InterviewCurrent;
	reportId: string;
};

export type InterviewsCurrentResponse = {
	interview: InterviewCurrent | null;
	reportId: string | null;
};

export type ReportResponse = { report: Report };

export type StaffReportsResponse = { reports: StaffReportSummary[] };
