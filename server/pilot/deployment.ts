import { createPilotPrincipals, pilotIdPattern } from './principals';
import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';

export type PilotIngressRequest = Readonly<{
	/** From the Node socket, never URL helpers, request headers or a body. */
	transport: 'http' | 'https';
	remoteAddress: string | undefined;
	method: string;
	/** Unmodified origin-form request target, before path normalization. */
	target: string;
	rawHeaders: readonly string[];
	/** Set only from the actual Node upgrade hook, never a request header. */
	upgrade?: 'websocket';
}>;

/** Invoke at first Node dispatch; do not derive input from an H3-normalized URL. */
export function readNodePilotRequest(
	req: IncomingMessage,
	upgrade?: 'websocket',
): PilotIngressRequest {
	return {
		transport:
			req.socket instanceof TLSSocket && req.socket.encrypted === true ?
				'https'
			:	'http',
		remoteAddress: req.socket.remoteAddress,
		method: req.method ?? '',
		target: req.url ?? '',
		rawHeaders: req.rawHeaders,
		...(upgrade ? { upgrade } : {}),
	};
}

export type PilotServerEnv = Readonly<
	Partial<
		Record<
			| 'SHIMA_MODE'
			| 'SHIMA_PILOT_ORIGIN'
			| 'SHIMA_PILOT_BUSINESS_ID'
			| 'SHIMA_PILOT_PRINCIPALS_JSON'
			| 'SHIMA_REAL_PILOT_ENABLED',
			string
		>
	>
>;

/** Load once at startup from server env and reuse. No proxy auth is configured
 * in this repository, so private ingress requires TLS all the way to Node. An
 * operator proxy may pass through TLS or re-encrypt on a restricted upstream;
 * it must preserve the pinned Host and strip client forwarding/identity fields.
 */
export function loadPilotDeployment(env: PilotServerEnv) {
	const mode = env.SHIMA_MODE ?? 'fixture-local';
	if (mode === 'fixture-local') {
		return { mode } as const;
	}
	// Separate public-demo/board ingress is deliberately not enabled by this helper.
	if (
		mode !== 'private-capture'
		&& !(mode === 'real-pilot' && env.SHIMA_REAL_PILOT_ENABLED === 'true')
	) {
		return null;
	}
	const { SHIMA_PILOT_ORIGIN: origin, SHIMA_PILOT_BUSINESS_ID: businessId } =
		env;
	if (
		!origin
		|| origin.length > 272
		|| !businessId
		|| !pilotIdPattern.test(businessId)
	) {
		return null;
	}
	const parsed = URL.parse(origin);
	if (
		!parsed
		|| parsed.protocol !== 'https:'
		|| parsed.origin !== origin
		|| parsed.hostname.length > 253
		|| !parsed.hostname
			.split('.')
			.every((label) =>
				/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
			)
		|| parsed.port === '0'
	) {
		return null;
	}
	const principals = createPilotPrincipals(
		businessId,
		env.SHIMA_PILOT_PRINCIPALS_JSON,
	);
	return principals ?
			({
				mode,
				origin,
				host: parsed.host,
				businessId,
				principals,
				realPilotEnabled: mode === 'real-pilot',
			} as const)
		:	null;
}

type Deployment = NonNullable<ReturnType<typeof loadPilotDeployment>>;

/** Use raw headers so Node's coalescing/first-value behavior cannot mask duplicates. */
export function checkPilotTransport(
	deployment: Deployment,
	request: PilotIngressRequest,
) {
	let host: string | undefined;
	let origin: string | undefined;
	let cookie: string | undefined;
	const { rawHeaders, method, transport, remoteAddress, upgrade } = request;
	if (
		(transport !== 'http' && transport !== 'https')
		|| rawHeaders.length % 2 !== 0
	) {
		return null;
	}
	for (let index = 0; index < rawHeaders.length; index += 2) {
		const key = rawHeaders[index]!.toLowerCase();
		const value = rawHeaders[index + 1]!;
		if (
			key === 'forwarded'
			|| key.startsWith('x-forwarded-')
			|| key === 'x-real-ip'
		) {
			return null;
		}
		if (key === 'host') {
			if (host !== undefined) {
				return null;
			}
			host = value;
		} else if (key === 'origin') {
			if (origin !== undefined) {
				return null;
			}
			origin = value;
		} else if (key === 'cookie') {
			if (cookie !== undefined) {
				return null;
			}
			cookie = value;
		}
	}
	if (deployment.mode === 'fixture-local') {
		if (
			remoteAddress !== '127.0.0.1'
			&& remoteAddress !== '::1'
			&& remoteAddress !== '::ffff:127.0.0.1'
		) {
			return null;
		}
		const loopbackHost =
			/^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?(?![\s\S])/.exec(
				host ?? '',
			);
		if (
			!loopbackHost
			|| (loopbackHost[1] && Number(loopbackHost[1]) > 65535)
		) {
			return null;
		}
		return origin === undefined || origin === `${transport}://${host}` ?
				{}
			:	null;
	}
	if (
		transport !== 'https'
		|| host !== deployment.host
		|| (origin === undefined ?
			method !== 'GET' || upgrade !== undefined
		:	origin !== deployment.origin)
	) {
		return null;
	}
	return { cookie };
}
