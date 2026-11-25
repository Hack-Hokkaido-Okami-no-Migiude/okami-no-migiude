// App-wide presentation locale, shared through the #shared Locale type.
// Contract for other workers: useAppLocale() returns { locale } where locale
// is a writable Ref<'ja' | 'en'>. The choice persists in a non-sensitive
// preference cookie ('app-locale'); nothing about the user's account or
// session is stored client-side.
// No runtime imports on purpose: Nuxt auto-imports useState/useCookie/watch,
// and Node's type stripping lets tests load this file directly.
import type { Locale } from '#shared/types/domain';

const LOCALE_COOKIE = 'app-locale';

export function useAppLocale() {
	const localeCookie = useCookie<Locale | null>(LOCALE_COOKIE, {
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
	});
	const locale = useState<Locale>(
		'shell:locale',
		() => localeCookie.value ?? 'ja',
	);

	// Keep the preference cookie in sync so the next server render (and other
	// useAppLocale() callers) see the same language.
	watch(locale, (value) => {
		localeCookie.value = value;
	});

	return { locale };
}
