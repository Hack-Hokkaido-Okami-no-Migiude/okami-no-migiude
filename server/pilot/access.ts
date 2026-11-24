export type PilotDeploymentMode =
	'fixture-local' | 'public-demo' | 'private-capture' | 'real-pilot';
export type PilotRole = 'owner' | 'reviewer' | 'admin' | 'engineer';

/** Derived from server authentication and assigned business membership, never from headers or a demo cookie. */
export type VerifiedPilotPrincipal = Readonly<{
	actorId: string;
	businessId: string;
	role: PilotRole;
}>;

type PilotDeployment = Readonly<{
	mode: PilotDeploymentMode;
	/** Server deployment setting; never a request value. Omitted means disabled. */
	realPilotEnabled?: boolean;
}>;

export type PilotAccessRequest = PilotDeployment
	& Readonly<{
		businessId: string;
		/** Classification of the target from trusted server state, not a request assertion. */
		dataKind: 'fixture' | 'pilot';
		principal: VerifiedPilotPrincipal | null;
		capability:
			| 'fixture-workbench'
			| 'fixture-release'
			| 'capture'
			| 'review'
			| 'owner-release-route'
			| 'reviewer-release-route'
			| 'admin-release-route';
	}>;

function roleInBusiness(
	principal: VerifiedPilotPrincipal | null | undefined,
	businessId?: string,
) {
	if (
		typeof businessId !== 'string'
		|| !businessId.trim()
		|| typeof principal?.actorId !== 'string'
		|| !principal.actorId.trim()
		|| principal.businessId !== businessId
	) {
		return null;
	}
	return principal.role;
}

/** Grants only mode/role eligibility, not consent, release, or permission to access another session. */
export function canAccessPilot(input: PilotAccessRequest): boolean {
	const {
		businessId,
		capability,
		dataKind,
		mode,
		principal,
		realPilotEnabled,
	} = input;
	const role = roleInBusiness(principal, businessId);
	if (mode === 'fixture-local' && dataKind === 'fixture') {
		return (
			(capability === 'fixture-workbench'
				&& (role === 'owner' || role === 'reviewer'))
			|| (capability === 'fixture-release' && role === 'owner')
		);
	}
	if (dataKind !== 'pilot') {
		return false;
	}
	if (mode === 'private-capture') {
		return (
			(capability === 'capture' || capability === 'review')
			&& (role === 'owner' || role === 'reviewer')
		);
	}
	if (mode !== 'real-pilot' || realPilotEnabled !== true) {
		return false;
	}
	switch (capability) {
		case 'capture':
		case 'owner-release-route':
			return role === 'owner';
		case 'review':
		case 'reviewer-release-route':
			return role === 'reviewer';
		case 'admin-release-route':
			return role === 'admin';
		default:
			return false;
	}
}

export type PilotPublicRoute = 'board' | 'asset' | 'list' | 'detail' | 'claim';

export type PilotPublicRouteRequest = PilotDeployment
	& Readonly<{
		method: string;
		/** Exact path spelling, without query; do not decode or normalize aliases into allowed paths. */
		pathname: string;
		/** For a real claim only: trusted target business from the published record, never a private join. */
		businessId?: string;
		principal?: VerifiedPilotPrincipal | null;
	}>;

const QUEST_PATH =
	/^\/api\/quests\/qst_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(\/claim)?$/;

/** Null means denied; node/build assets are not admitted by a path prefix. */
export function checkPilotPublicRoute(
	input: PilotPublicRouteRequest,
): PilotPublicRoute | null {
	const { businessId, method, mode, pathname, principal, realPilotEnabled } =
		input;
	if (
		mode !== 'fixture-local'
		&& mode !== 'public-demo'
		&& !(mode === 'real-pilot' && realPilotEnabled === true)
	) {
		return null;
	}
	if (method === 'GET') {
		if (pathname === '/quests') {
			return 'board';
		}
		if (pathname === '/favicon.ico') {
			return 'asset';
		}
		if (pathname === '/api/quests') {
			return 'list';
		}
	}
	const quest = QUEST_PATH.exec(pathname);
	if (!quest || quest[0] !== pathname) {
		return null;
	}
	if (method === 'GET' && !quest[1]) {
		return 'detail';
	}
	if (
		method === 'POST'
		&& quest[1]
		&& (mode !== 'real-pilot'
			|| roleInBusiness(principal, businessId) === 'engineer')
	) {
		return 'claim';
	}
	return null;
}
