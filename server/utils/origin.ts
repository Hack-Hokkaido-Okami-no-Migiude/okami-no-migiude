// Same-origin enforcement for state-changing browser writes (approved
// override). Browsers always send Origin on POST; a mismatched Origin or a
// cross-site Sec-Fetch-Site is rejected with the §6 envelope. Missing headers
// (non-browser clients such as curl or server-to-server calls) pass through.
import type { H3Event } from 'h3';
import { apiError } from './errors';
import { getHeader } from 'h3';
import { publicBaseUrl } from './env';

export function assertSameOrigin(event: H3Event): void {
	const fetchSite = getHeader(event, 'sec-fetch-site');
	if (fetchSite && fetchSite !== 'same-origin') {
		throw apiError(403, 'forbidden', 'Cross-site writes are not allowed');
	}
	const origin = getHeader(event, 'origin');
	if (!origin) {
		return;
	}
	if (origin !== new URL(publicBaseUrl()).origin) {
		throw apiError(403, 'forbidden', 'Cross-origin writes are not allowed');
	}
}
