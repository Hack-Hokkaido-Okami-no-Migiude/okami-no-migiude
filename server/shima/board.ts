import { getCookie, getHeader, getRouterParam, setCookie } from 'h3';
import { invalidInput, notFound } from '../utils/http';
import type { H3Event } from 'h3';
import { PublicQuestIdSchema } from '../../shared/shima/schemas';
import { randomUUID } from 'node:crypto';

const ENGINEER_COOKIE = 'shima_engineer';
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function publicQuestId(event: H3Event): string {
	const parsed = PublicQuestIdSchema.safeParse(getRouterParam(event, 'questId'));
	if (!parsed.success) {
		throw notFound();
	}
	return parsed.data;
}

export function engineerCookie(event: H3Event): string | null {
	const value = getCookie(event, ENGINEER_COOKIE);
	return value && uuidV4.test(value) ? value : null;
}

function encrypted(event: H3Event): boolean {
	const socket = event.node.req.socket;
	return 'encrypted' in socket && socket.encrypted === true;
}

export function issueEngineerCookie(event: H3Event): void {
	if (!engineerCookie(event)) {
		setCookie(event, ENGINEER_COOKIE, randomUUID(), {
			path: '/api/quests', sameSite: 'strict', httpOnly: true,
			secure: encrypted(event), maxAge: 60 * 60 * 24 * 365,
		});
	}
}

/** Only direct same-origin loopback claims; no forwarded host/scheme trust. */
export function assertFixtureClaimOrigin(event: H3Event): void {
	const { localPort, remoteAddress } = event.node.req.socket;
	const scheme = encrypted(event) ? 'https' : 'http';
	const portSuffix = localPort === (scheme === 'https' ? 443 : 80) ? '' : `:${localPort}`;
	const host = getHeader(event, 'host');
	if (!localPort || !remoteAddress || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)
		|| !host || !['localhost', '127.0.0.1', '[::1]'].some((name) => host === `${name}${portSuffix}`)
		|| getHeader(event, 'origin') !== `${scheme}://${host}`) {
		throw invalidInput();
	}
}
