// Cross-boundary domain types (contract §4, with the approved overrides at the
// top of docs/mvp-contract.md applied: 11-value BusinessType, SessionUser as a
// discriminated union by role, and `mode` exposed on InterviewCurrent).
// Type-only module: no runtime exports, safe to import from app and server.

export type Locale = 'ja' | 'en';

export type UserRole = 'owner' | 'staff';

export type BusinessType =
	| 'accommodation'
	| 'food_service'
	| 'retail'
	| 'tourism'
	| 'agriculture'
	| 'manufacturing'
	| 'construction'
	| 'transport'
	| 'healthcare'
	| 'professional_services'
	| 'other';

export type OwnerProfile = {
	name: string;
	email: string; // account email; set server-side at signup, never edited in MVP
	businessName: string;
	businessType: BusinessType;
	otherBusinessType: string | null; // required when businessType is 'other'
	municipality: string;
	phone: string | null;
	website: string | null;
	note: string | null;
	locale: Locale;
};

export type StaffProfile = {
	name: string; // defaults to the email local part at provisioning
	email: string;
};

/** Discriminated by role (approved override). */
export type SessionUser =
	| { id: string; role: 'owner'; profile: OwnerProfile }
	| { id: string; role: 'staff'; profile: StaffProfile };

export type InterviewMode = 'demo' | 'live';

export type InterviewStatus = 'active' | 'submitted';

/** Shape exposed by GET /api/interviews/current and start/complete. */
export type InterviewCurrent = {
	id: string;
	status: InterviewStatus;
	deadlineAt: string; // ISO 8601 UTC
	mode: InterviewMode;
};

/** Full interview row (server-side; never returned whole by the API). */
export type Interview = {
	id: string;
	ownerId: string;
	mode: InterviewMode;
	status: InterviewStatus;
	consentAt: string; // equals startedAt in MVP
	startedAt: string;
	deadlineAt: string; // startedAt + 1 hour
	submittedAt: string | null;
	transcript: string | null;
};

export type ReportStatus = 'pending' | 'ready' | 'failed';

/**
 * What produced the report content: the rule-based demo analyzer (headless
 * demo path) or the Dify post-call assessment (live engine). Drives the
 * honest page label — a Dify report is never presented as a rule-based
 * estimate.
 */
export type ReportGenerator = 'rule_based' | 'dify';

export type Report = {
	id: string;
	/** Null for voice-sourced reports (they come from a voice session). */
	interviewId: string | null;
	ownerId: string;
	businessName: string; // snapshot of the owner profile at submit time
	locale: Locale; // snapshot of the owner profile at submit time
	generator: ReportGenerator;
	status: ReportStatus;
	content: string | null; // Markdown; null while pending/failed
	failureReason: string | null; // set only when status is 'failed'
	consultationRequestedAt: string | null;
	createdAt: string;
	readyAt: string | null;
};

/** Shape returned by GET /api/staff/reports. */
export type StaffReportSummary = {
	id: string;
	ownerId: string;
	ownerName: string;
	ownerEmail: string;
	businessName: string;
	locale: Locale;
	status: ReportStatus;
	consultationRequestedAt: string | null;
	createdAt: string;
};
