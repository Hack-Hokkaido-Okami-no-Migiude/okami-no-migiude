// Voice chat wire payload types. Type-only module. Voice sessions are a
// separate surface from the §5 interview contract: conversation only — the
// transcript and research cases are recorded, no report is produced yet.
import type { Locale } from './domain';

export type VoiceConfigResponse = { available: boolean };

export type VoiceBusiness = {
	businessName: string;
	location: string;
	businessType: string;
};

export type VoiceResearchStatus =
	'idle' | 'queued' | 'submitting' | 'polling' | 'completed' | 'failed';

export type VoiceResearchCase = {
	title: string;
	company: string;
	problem: string;
	solution: string;
	outcome: string;
	applicability: string;
	costComplexity: string;
	sourceUrls: string[];
};

export type VoiceSessionStartRequest = { consent: true };

export type VoiceSessionStartResponse = {
	conversationId: string;
	conversationToken: string;
};

export type VoiceSessionStatus = {
	conversationId: string;
	createdAt: string;
	reportLanguage: Locale;
	research: {
		status: VoiceResearchStatus;
		started: boolean;
		business: VoiceBusiness | null;
		cases: VoiceResearchCase[];
	};
	transcriptRecorded: boolean;
	transcript: string | null;
};

export type VoiceCurrentResponse = { session: VoiceSessionStatus | null };
