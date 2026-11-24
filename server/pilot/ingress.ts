import {
	type PilotAccessRequest,
	type VerifiedPilotPrincipal,
	canAccessPilot,
	checkPilotPublicRoute,
} from './access';
import {
	type PilotIngressRequest,
	type PilotServerEnv,
	checkPilotTransport,
	loadPilotDeployment,
} from './deployment';

export const pilotIngressNotFound = Object.freeze({
	kind: 'deny',
	status: 404,
	cacheControl: 'no-store',
	body: Object.freeze({
		error: Object.freeze({ code: 'not_found', message: 'Not found.' }),
	}),
} as const);

const landing = {
	kind: 'landing',
	serialization: 'generic-only',
	cacheControl: 'no-store',
} as const;
const fixture = {
	kind: 'fixture',
	serialization: 'fixture-only',
	cacheControl: 'no-store',
} as const;
const asset = { kind: 'asset', serialization: 'static-only' } as const;

type Capability = Extract<
	PilotAccessRequest['capability'],
	'capture' | 'review' | `${string}-release-route`
>;
type RoutePolicy = Readonly<{
	method: string;
	pattern: RegExp;
	privateCapabilities?: readonly Capability[];
	ownerOnly?: true;
	fixture?: true;
	upgrade?: 'websocket';
}>;

const id = '[A-Za-z0-9_-]{1,128}';
const clients = '/api/clients';
const client = `${clients}/(${id})`;
const session = `${client}/sessions/${id}`;
const shima = `${session}/shima`;
const packages = `${shima}/packages`;
const pkg = `${packages}/${id}`;
const opportunity = `${session}/opportunities/${id}`;
const person = `${shima}/participants/${id}`;
const purpose = '(?:local-capture|recorded-stt|live-voice|external-analysis)';
const capture = ['capture'] as const;

const member = ['capture', 'review'] as const;
const ownerRelease = ['owner-release-route'] as const;
const reviewerRelease = ['reviewer-release-route'] as const;
const adminRelease = ['admin-release-route'] as const;

function route(
	method: string,
	path: string,
	options: Omit<RoutePolicy, 'method' | 'pattern'>,
): RoutePolicy {
	return { method, pattern: new RegExp(`^${path}$`), ...options };
}

const routes = [
	// Unscoped legacy index/create may access other businesses; fixture only.
	route('GET', clients, { fixture: true }),
	route('POST', clients, { fixture: true }),
	route('POST', '/api/demo/hotel', { fixture: true }),
	route('GET', `${client}/sessions`, {
		fixture: true,
		privateCapabilities: member,
	}),
	route('POST', `${client}/sessions`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('GET', session, { fixture: true, privateCapabilities: member }),
	route('PUT', `${session}/transcript`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('DELETE', `${session}/transcript`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('POST', `${session}/transcribe`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('POST', `${session}/analyze`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('PUT', `${session}/questions/${id}/answer`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('PATCH', `${session}/steps/${id}`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('PATCH', opportunity, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('GET', `${opportunity}/plan\\.md`, {
		fixture: true,
		privateCapabilities: member,
	}),
	route('PATCH', `${opportunity}/plan`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('POST', `${opportunity}/proposal`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('GET', `${shima}/map`, {
		fixture: true,
		privateCapabilities: member,
	}),
	route('PUT', `${shima}/effort/${id}`, {
		fixture: true,
		privateCapabilities: capture,
	}),
	route('GET', packages, { fixture: true, privateCapabilities: member }),
	route('POST', packages, { fixture: true, privateCapabilities: capture }),
	route('PATCH', pkg, { fixture: true, privateCapabilities: capture }),
	route('POST', `${pkg}/preview`, { fixture: true }),
	route('POST', `${pkg}/publish`, { fixture: true }),
	route('GET', `${shima}/participants`, { privateCapabilities: capture }),
	route('POST', `${shima}/participants`, {
		privateCapabilities: capture,
		ownerOnly: true,
	}),
	route('DELETE', person, { privateCapabilities: capture, ownerOnly: true }),
	route('PUT', `${person}/consent/${purpose}`, {
		privateCapabilities: capture,
	}),
	route('POST', `${shima}/interview/start`, { privateCapabilities: capture }),
	route('GET', `${shima}/interview/stream`, {
		privateCapabilities: capture,
		upgrade: 'websocket',
	}),
	route('POST', `${shima}/interview/stop`, { privateCapabilities: capture }),
	route('POST', `${shima}/interview/turns`, { privateCapabilities: capture }),
	route('POST', `${pkg}/decision`, { privateCapabilities: capture }),
	route('POST', `${pkg}/complete`, { privateCapabilities: ownerRelease }),
	route('POST', `${pkg}/pilot/preview`, {
		privateCapabilities: reviewerRelease,
	}),
	route('POST', `${pkg}/pilot/review`, {
		privateCapabilities: reviewerRelease,
	}),
	route('POST', `${pkg}/pilot/approve`, {
		privateCapabilities: ownerRelease,
	}),
	route('POST', `${pkg}/pilot/permit`, { privateCapabilities: adminRelease }),
	route('POST', `${pkg}/pilot/publish`, {
		privateCapabilities: adminRelease,
	}),
	route('POST', `${pkg}/pilot/withdraw`, {
		privateCapabilities: [...ownerRelease, ...adminRelease],
	}),
];

function exactPath(target: string): string | null {
	if (
		target.length > 8192
		|| !/^[\x21-\x7e]+$/.test(target)
		|| target.includes('#')
	) {
		return null;
	}
	const path = target.split('?', 1)[0]!;
	if (path === '/') {
		return path;
	}
	if (!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(path)) {
		return null;
	}
	return (
			path
				.split('/')
				.some((segment) => segment === '.' || segment === '..')
		) ?
			null
		:	path;
}

// No runtime prefix admission, source maps, manifests or prerendered payloads.
const staticAsset =
	/^\/_nuxt\/[A-Za-z0-9_.-]+\.(?:css|js|woff2?|ttf|svg|png|webp)$/;
const pages = new Set(['/', '/shima', '/workbench']);

/**
 * Instantiate once per isolated Node process. `builtAssets` must be exact,
 * reviewed public build files; never use handler paths, assets from data storage
 * or prerender output. This gate is necessary, not sufficient: handlers still
 * authenticate the actual stored scope/data kind, consent and per-action grants.
 */
export function createPilotIngress(
	env: PilotServerEnv,
	builtAssets: readonly string[] = [],
) {
	const deployment = loadPilotDeployment(env);
	const assets = new Set([
		'/favicon.ico',
		...builtAssets.filter(
			(path) =>
				exactPath(path) === path
				&& staticAsset.test(path)
				&& !path.includes('_payload'),
		),
	]);
	const privateDeployment =
		deployment?.mode === 'fixture-local' ? null : deployment;
	const canIssuePrivateCookie = (request: PilotIngressRequest) =>
		Boolean(
			privateDeployment
			&& request.method === 'POST'
			&& request.upgrade === undefined
			&& exactPath(request.target) === request.target
			&& checkPilotTransport(privateDeployment, request),
		);
	return {
		/** No login route is installed here. Match a dedicated exact POST in the
		 * adapter, then check this before reading a bounded token body.
		 */
		canIssuePrivateCookie,
		/** Return this only as Set-Cookie with no-store; never log credentials. */
		issuePrivateCookie(
			request: PilotIngressRequest,
			token: unknown,
		): string | null {
			if (!privateDeployment || !canIssuePrivateCookie(request)) {
				return null;
			}
			return privateDeployment.principals.issuePrivateCookie(token);
		},
		decide(request: PilotIngressRequest) {
			if (!deployment) {
				return pilotIngressNotFound;
			}
			const transport = checkPilotTransport(deployment, request);
			const pathname = exactPath(request.target);
			if (!transport || !pathname) {
				return pilotIngressNotFound;
			}
			const { method, upgrade } = request;
			const page =
				method === 'GET'
				&& upgrade === undefined
				&& pages.has(pathname);
			if (
				method === 'GET'
				&& upgrade === undefined
				&& assets.has(pathname)
			) {
				return asset;
			}
			const matched = routes.find(
				(route) =>
					route.method === method
					&& route.upgrade === upgrade
					&& route.pattern.test(pathname),
			);
			if (deployment.mode === 'fixture-local') {
				if (
					page
					|| matched?.fixture
					|| (upgrade === undefined
						&& ((method === 'GET' && pathname === '/robots.txt')
							|| checkPilotPublicRoute({
								mode: deployment.mode,
								method,
								pathname,
							})))
				) {
					return fixture;
				}
				return pilotIngressNotFound;
			}
			const principal = deployment.principals.fromPrivateCookie(
				transport.cookie,
			);
			const allowed = (
				businessId: string,
				capabilities: readonly Capability[],
			) =>
				Boolean(
					principal
					&& capabilities.some((capability) =>
						canAccessPilot({
							mode: deployment.mode,
							realPilotEnabled: deployment.realPilotEnabled,
							dataKind: 'pilot',
							businessId,
							principal,
							capability,
						}),
					),
				);
			const allowPrivate = (principal: VerifiedPilotPrincipal) =>
				({
					kind: 'private',
					serialization: 'private',
					cacheControl: 'no-store',
					principal,
				}) as const;
			if (page) {
				if (principal && allowed(deployment.businessId, member)) {
					return allowPrivate(principal);
				}
				// A restricted landing renderer only; never fall through to normal SSR.
				if (pathname === '/') {
					return landing;
				}
				return pilotIngressNotFound;
			}
			const businessId = matched?.pattern.exec(pathname)?.[1];
			if (
				!principal
				|| !businessId
				|| !matched?.privateCapabilities
				|| (matched.ownerOnly && principal.role !== 'owner')
				|| !allowed(businessId, matched.privateCapabilities)
			) {
				return pilotIngressNotFound;
			}
			return allowPrivate(principal);
		},
	};
}
