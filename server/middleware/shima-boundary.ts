import { IncomingMessage, type ServerResponse } from 'node:http';
import type { PilotIngressRequest, PilotServerEnv } from '../pilot/deployment';
import { checkPilotTransport, readNodePilotRequest } from '../pilot/deployment';
import { createPilotIngress, pilotIngressNotFound } from '../pilot/ingress';

export const pilotLoginPath = '/api/pilot-auth/session';
const dispatched = new WeakSet<IncomingMessage>();
const deniedBody = JSON.stringify(pilotIngressNotFound.body);
const jsonType = 'application/json; charset=utf-8';
const fixtureExtraAsset = /^\/_nuxt\/(?:fonts\/[A-Za-z0-9_.-]+\.(?:woff2?|ttf)|builds\/(?:latest\.json|meta\/[A-Za-z0-9_-]+\.json))$/;

/**
 * Exact fictional demo audio for the owner-facing walkthrough, reachable in
 * fixture-local only. Never a /demo prefix and never present in private or
 * public-demo modes: the boundary only admits these exact paths, so future
 * assets must extend this list deliberately.
 */
const fixtureDemoAudio = new Set([
	'/demo/shima/shima-demo-intro-owner.wav',
	'/demo/shima/shima-demo-question-shima.wav',
	'/demo/shima/shima-demo-answer-owner.wav',
]);

/**
 * Nitro's dev front server (createDevServer) proxies each request to the dev
 * worker over a local hop, stamps its own `x-forwarded-for`, `-port` and
 * `-proto` fields (createHTTPProxy does this on every proxied request), and
 * hands them to a worker that listens on a named pipe
 * (`\\.\pipe\nitro-worker-*.sock`), where `req.socket.remoteAddress` is
 * undefined. Inside that worker the hop is infrastructure, not a client claim,
 * so evaluation ignores the stamped fields and anchors the addressless pipe
 * socket to the loopback front server that owns it; the transport stays the
 * front server's plain HTTP socket, so private ingress still fails TLS-to-Node.
 * Production builds never run as a dev worker and keep the strict rejection of
 * both forwarded headers and addressless sockets. The fields are never read as
 * authorization.
 */
const trustedDevFrontServer = process.env.NITRO_DEV_WORKER_ID !== undefined;
const forwardedField = /^(?:forwarded|x-forwarded-.+|x-real-ip)$/;

/**
 * Return the request as the trusted local front server presented it, without
 * the hop's own forwarding fields. Idempotent; preserves malformed odd-length
 * header blocks so the strict raw-header checks still reject them.
 */
export function withoutForwardedFields(
	request: PilotIngressRequest,
): PilotIngressRequest {
	if (!trustedDevFrontServer) { return request; }
	const kept: string[] = [];
	const headers = request.rawHeaders;
	for (let index = 0; index < headers.length; index += 2) {
		const name = headers[index]!;
		const value = headers[index + 1];
		if (forwardedField.test(name.toLowerCase())) { continue; }
		if (value === undefined) { kept.push(name); break; }
		kept.push(name, value);
	}
	return { ...request, rawHeaders: kept };
}

/**
 * Return the request as evaluated inside the dev worker: without the hop's
 * forwarding fields, and — because only the local pipe hop leaves the socket
 * address undefined — anchored to the loopback front server that owns it.
 * Real TCP sockets always carry an address, and empty-string mock sockets stay
 * rejected, so nothing else is re-anchored.
 */
export function frontServerView(
	request: PilotIngressRequest,
): PilotIngressRequest {
	const direct = withoutForwardedFields(request);
	if (!trustedDevFrontServer || direct.remoteAddress !== undefined) {
		return direct;
	}
	return { ...direct, remoteAddress: '127.0.0.1' };
}

export function hidePilotRoute(response: ServerResponse) {
	response.statusCode = pilotIngressNotFound.status;
	response.setHeader('Cache-Control', pilotIngressNotFound.cacheControl);
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Content-Type', jsonType);
	response.shouldKeepAlive = false;
	response.end(deniedBody);
}

function sendLanding(response: ServerResponse, signedIn: boolean) {
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Referrer-Policy', 'no-referrer');
	response.setHeader('Content-Type', 'text/html; charset=utf-8');
	response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
	response.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>シマエナガ</title><main><h1>シマエナガ</h1>${signedIn ?
		'<p>サインイン済みです。面談・ワークベンチ・公開機能は現在ご利用いただけません。</p>'
		: `<h2>サインイン</h2><form action="${pilotLoginPath}" method="post"><label>アクセスコード <input name="token" type="password" required minlength="43" maxlength="43" autocomplete="current-password"></label><button type="submit">サインイン</button></form><p>架空のデモについては管理者へお問い合わせください。</p>`}</main></html>`);
}

function isHttpRequest(raw: PilotIngressRequest) {
	return !raw.rawHeaders.some((name, index) => index % 2 === 0 && (
		name.toLowerCase() === 'upgrade'
		|| (name.toLowerCase() === 'connection' && raw.rawHeaders[index + 1]?.split(',').some((part) => part.trim().toLowerCase() === 'upgrade'))
	));
}

export function createShimaBoundary(env: PilotServerEnv, hasBuiltAsset: (path: string) => boolean) {
	const ingress = createPilotIngress(env);
	const fixture = env.SHIMA_MODE === undefined || env.SHIMA_MODE === 'fixture-local';
	const privateCapture = env.SHIMA_MODE === 'private-capture';
	const canLogin = (request: PilotIngressRequest) => {
		const direct = frontServerView(request);
		return privateCapture
			&& direct.target === pilotLoginPath
			&& isHttpRequest(direct)
			&& ingress.canIssuePrivateCookie(direct);
	};

	return {
		canLogin,
		issueCookie(request: PilotIngressRequest, token: string) {
			const direct = frontServerView(request);
			return canLogin(direct) ? ingress.issuePrivateCookie(direct, token) : null;
		},
		/** Run before Nitro's H3 stack, including route rules and its static handler. */
		admit(req: IncomingMessage, res: ServerResponse): boolean {
			const raw = frontServerView(readNodePilotRequest(req));
			if (req instanceof IncomingMessage && isHttpRequest(raw)) {
				if (fixture) {
					const [path = '', query] = raw.target.split(/\?(.*)/s, 2);
					const decision = ingress.decide(raw);
					if (decision.kind === 'fixture') {
						res.setHeader('Cache-Control', decision.cacheControl);
						return true;
					}
					// These transitions postdate the verified policy. Reuse the
					// fixture package path check, without rewriting the request.
					if (raw.method === 'POST' && /\/(?:decision|complete)$/.test(path) && ingress.decide({
						...raw,
						target: path.replace(/\/(?:decision|complete)$/, '/publish') + (query === undefined ? '' : `?${query}`),
					}).kind === 'fixture') {
						res.setHeader('Cache-Control', 'no-store');
						return true;
					}
					if (raw.method === 'GET' && /^[\x21-\x7e]{1,8192}$/.test(raw.target) && !raw.target.includes('#')
						&& checkPilotTransport({ mode: 'fixture-local' }, raw) && hasBuiltAsset(path)
						&& (fixtureExtraAsset.test(path) || fixtureDemoAudio.has(path) || createPilotIngress(env, [path]).decide(raw).kind === 'asset')) {
						return true;
					}
				} else if (privateCapture) {
					if (canLogin(raw)) {return true;}
					// Only an isolated shell ships. No resource or private SSR is
					// allowed until handlers verify the stored data kind and scope.
					if (raw.target === '/' || raw.target === '/shima') {
						const decision = ingress.decide(raw);
						if (raw.target === '/' && (decision.kind === 'landing' || decision.kind === 'private')) {
							sendLanding(res, decision.kind === 'private');
							return false;
						}
						if (raw.target === '/shima' && decision.kind === 'private') {
							res.statusCode = 303;
							res.setHeader('Cache-Control', 'no-store');
							res.setHeader('Location', '/');
							res.end();
							return false;
						}
					}
				}
			}
			// Unimplemented modes, new routes, and ordinary HTTP requests
			// bearing upgrade headers never fall through to Nitro handlers.
			hidePilotRoute(res);
			return false;
		},
	};
}

export function markShimaDispatch(request: IncomingMessage) {
	dispatched.add(request);
}

// Defense in depth for dynamic routes if the pre-dispatch plugin was not
// installed. This middleware by itself cannot protect Nitro's static layer.
export default function shimaBoundaryMiddleware(event: { node: { req: IncomingMessage; res: ServerResponse } }) {
	if (!dispatched.has(event.node.req)) {hidePilotRoute(event.node.res);}
}
