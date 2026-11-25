// Bridge to the shared app shell for the report page.
//
// The lead-owned shell exposes `useAppLocale() -> { locale }` and
// `useOwnerSession() -> { user, refreshSession, clearSession }` (see
// docs/mvp-contract.md work coordination). This thin bridge keeps the
// report page depending on one stable shape instead of calling the
// shell composables from many places.
import type { Ref } from 'vue';
import type { Locale, SessionUser } from '#shared/types/domain';

export type ReportShell = {
	locale: Ref<Locale>;
	user: Ref<SessionUser | null>;
	refreshSession: () => Promise<void>;
	clearSession: () => void;
};

export function useReportShell(): ReportShell {
	const { locale } = useAppLocale();
	const session = useOwnerSession();
	return {
		locale,
		user: session.user,
		refreshSession: session.refreshSession,
		clearSession: session.clearSession,
	};
}
