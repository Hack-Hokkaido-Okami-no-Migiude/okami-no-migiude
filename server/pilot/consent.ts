export type PilotExternalPurpose =
	'recorded-stt' | 'live-voice' | 'external-analysis';
export type PilotConsentPurpose = 'local-capture' | PilotExternalPurpose;

export type PilotConsentScope = Readonly<{
	businessId: string;
	sessionId: string;
	/** Server version, never reused after any roster or seat change. */
	rosterVersion: string;
	localNoticeVersion: string;
	roster: readonly Readonly<{ participantId: string; actorId: string }>[];
}>;

type SessionBinding = Pick<
	PilotConsentScope,
	'businessId' | 'sessionId' | 'rosterVersion'
>;
type ExternalDisclosure = Readonly<{
	purpose: PilotExternalPurpose;
	noticeVersion: string;
	/** Actual provider(s) being contacted and server revision, never reused after a provider change. */
	provider: string;
	providerRevision: string;
}>;
type ConsentBinding = SessionBinding
	& (
		| ExternalDisclosure
		| Readonly<{
				purpose: 'local-capture';
				noticeVersion: string;
				provider: null;
				providerRevision: null;
		  }>
	);

export type PilotConsentReceipt = ConsentBinding
	& Readonly<{
		participantId: string;
		actorId: string;
		recordedAt: string;
		status: 'active' | 'revoked';
	}>;

type ExternalAction = ExternalDisclosure
	& Readonly<{
		/** Server identity for one disclosed call, upload, or revision/batch, not a reusable opt-in. */
		operationId: string;
	}>;

export type PilotActionConfirmation = SessionBinding
	& ExternalAction
	& Readonly<{ confirmed: true }>;

export type PilotConsentRequest = Readonly<{
	scope: PilotConsentScope;
	action: Readonly<{ purpose: 'local-capture' }> | ExternalAction;
	/** Authoritative current entries, not history; missing and duplicate entries deny. */
	receipts: readonly PilotConsentReceipt[];
	/** Bound by the caller to the authorized actor's explicit confirmation. */
	confirmation?: PilotActionConfirmation | null;
}>;

function nonBlank(value: string): boolean {
	return typeof value === 'string' && value.trim().length !== 0;
}

function validScope(scope: PilotConsentScope): boolean {
	const { businessId, sessionId, rosterVersion, localNoticeVersion, roster } =
		scope;
	if (
		![businessId, sessionId, rosterVersion, localNoticeVersion].every(
			nonBlank,
		)
		|| roster.length === 0
	) {
		return false;
	}
	const participants = new Set<string>();
	const actors = new Set<string>();
	for (const { participantId, actorId } of roster) {
		if (
			!nonBlank(participantId)
			|| !nonBlank(actorId)
			|| participants.has(participantId)
			|| actors.has(actorId)
		) {
			return false;
		}
		participants.add(participantId);
		actors.add(actorId);
	}
	return true;
}

function matchesBinding(
	actual: ConsentBinding,
	expected: ConsentBinding,
): boolean {
	return (
		actual.businessId === expected.businessId
		&& actual.sessionId === expected.sessionId
		&& actual.rosterVersion === expected.rosterVersion
		&& actual.purpose === expected.purpose
		&& actual.noticeVersion === expected.noticeVersion
		&& actual.provider === expected.provider
		&& actual.providerRevision === expected.providerRevision
	);
}

function allParticipantsConsented(
	roster: PilotConsentScope['roster'],
	receipts: readonly PilotConsentReceipt[],
	binding: ConsentBinding,
): boolean {
	return roster.every(({ participantId, actorId }) => {
		const current = receipts.filter(
			(receipt) =>
				receipt.businessId === binding.businessId
				&& receipt.sessionId === binding.sessionId
				&& receipt.purpose === binding.purpose
				&& receipt.participantId === participantId,
		);
		const receipt = current[0];
		return (
			current.length === 1
			&& receipt !== undefined
			&& receipt.status === 'active'
			&& receipt.actorId === actorId
			&& nonBlank(receipt.recordedAt)
			&& matchesBinding(receipt, binding)
		);
	});
}

/** Evaluate current consent only; the caller owns authenticated seats, operation identity and atomic rechecks. */
export function canUsePilotConsent({
	scope,
	action,
	receipts,
	confirmation,
}: PilotConsentRequest): boolean {
	if (!validScope(scope)) {
		return false;
	}
	const { businessId, sessionId, rosterVersion, roster, localNoticeVersion } =
		scope;
	const session = { businessId, sessionId, rosterVersion };
	if (
		!allParticipantsConsented(roster, receipts, {
			...session,
			purpose: 'local-capture',
			noticeVersion: localNoticeVersion,
			provider: null,
			providerRevision: null,
		})
	) {
		return false;
	}
	if (action.purpose === 'local-capture') {
		return true;
	}
	if (
		action.purpose !== 'recorded-stt'
		&& action.purpose !== 'live-voice'
		&& action.purpose !== 'external-analysis'
	) {
		return false;
	}
	const { purpose, noticeVersion, provider, providerRevision, operationId } =
		action;
	const binding = {
		...session,
		purpose,
		noticeVersion,
		provider,
		providerRevision,
	};
	return (
		[noticeVersion, provider, providerRevision, operationId].every(nonBlank)
		&& confirmation?.confirmed === true
		&& confirmation.operationId === operationId
		&& matchesBinding(confirmation, binding)
		&& allParticipantsConsented(roster, receipts, binding)
	);
}
