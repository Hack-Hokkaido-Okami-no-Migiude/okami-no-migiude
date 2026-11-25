// Interview flow state machine for the interview surface: session gating,
// the availability probe, the consent gate (which must complete before the
// conversation is minted or started), the live start, the call and the
// post-call monitoring. The API client and clock are injected so the whole
// machine is unit-testable without a browser build.
//
// The live conversation itself is started from a server-minted token:
// entering the live phase mints a WebRTC conversation for the active
// interview (POST /api/voice/sessions) and exposes the grant for the page's
// conversation controller. The mint never precedes consent — live entry
// happens only through start() (gated on the consent phase and all three
// consents) or through resuming an interview whose consent the server
// already recorded at start. There is no UI timer: the agent manages the
// session length, and the transcript reaches the server through the
// post-call webhook even after the owner has left the page, matched by the
// mint-time conversation↔interview record. The page never submits a
// transcript itself; `refresh()` only polls the current interview so the
// page can follow research → submitted → report states.
import {
	ApiFailure,
	type AgentAvailability,
	type ConversationGrant,
	type InterviewClient,
} from '../utils/interview-api.ts';
import { type ComputedRef, type Ref, computed, ref } from 'vue';
import {
	type ConsentsState,
	allConsentsGiven,
	emptyConsents,
} from '../utils/interview-consent.ts';
import type {
	InterviewAssessmentSurface,
	InterviewCurrent,
	InterviewResearchSurface,
	SessionUser,
} from '../../shared/types/domain.ts';

export type FlowPhase =
	| 'checking'
	| 'agent-unavailable'
	| 'unavailable'
	| 'signed-out'
	| 'staff'
	| 'intro'
	| 'consent'
	| 'live'
	| 'ended'
	| 'submitted'
	| 'demo-active';

export type FlowErrorCode =
	| 'network'
	| 'internal'
	| 'unauthorized'
	| 'forbidden'
	| 'not_found'
	| 'validation'
	| 'interview_active'
	| 'interview_expired'
	| 'already_submitted'
	| 'mode_unavailable';

const FLOW_ERROR_CODES: ReadonlySet<string> = new Set([
	'network',
	'internal',
	'unauthorized',
	'forbidden',
	'not_found',
	'validation',
	'interview_active',
	'interview_expired',
	'already_submitted',
	'mode_unavailable',
]);

export type InterviewFlowController = {
	phase: Ref<FlowPhase>;
	interview: Ref<InterviewCurrent | null>;
	reportId: Ref<string | null>;
	consents: Ref<ConsentsState>;
	canStart: ComputedRef<boolean>;
	error: Ref<FlowErrorCode | null>;
	availability: Ref<AgentAvailability | null>;
	/**
	 * The minted conversation for the live phase (null outside it): the
	 * page's conversation controller consumes the token to start the
	 * WebRTC session.
	 */
	conversation: Ref<ConversationGrant | null>;
	/** The active interview's research surface (live rows only). */
	research: ComputedRef<InterviewResearchSurface | null>;
	/** The active interview's Dify assessment surface (live rows only). */
	assessment: ComputedRef<InterviewAssessmentSurface | null>;
	/** Applies the shell-provided session user and routes the phase. */
	notifySession(user: SessionUser | null): Promise<void>;
	/** Full re-probe: availability + current (retry path). */
	init(): Promise<void>;
	beginConsent(): void;
	start(): Promise<void>;
	/** The page's explicit end action: leave the call view and monitor. */
	notifyCallEnded(): void;
	/** One current() poll; network blips are swallowed, never fatal. */
	refresh(): Promise<void>;
	restart(): Promise<void>;
};

export type InterviewFlowDependencies = {
	client: InterviewClient;
	now?: () => number;
};

export function createInterviewFlow(
	deps: InterviewFlowDependencies,
): InterviewFlowController {
	const phase = ref<FlowPhase>('checking');
	const interview = ref<InterviewCurrent | null>(null);
	const reportId = ref<string | null>(null);
	const consents = ref<ConsentsState>(emptyConsents());
	const error = ref<FlowErrorCode | null>(null);
	const availability = ref<AgentAvailability | null>(null);
	const conversation = ref<ConversationGrant | null>(null);

	const canStart = computed(() => allConsentsGiven(consents.value));
	const research = computed(() => interview.value?.research ?? null);
	const assessment = computed(() => interview.value?.assessment ?? null);

	function codeOf(failure: unknown): string {
		if (failure instanceof ApiFailure) {
			return failure.code;
		}
		return 'network';
	}

	function toFlowCode(raw: string): FlowErrorCode {
		return (FLOW_ERROR_CODES.has(raw) ? raw : 'internal') as FlowErrorCode;
	}

	/** Availability probe; a probe failure keeps the generic retryable state. */
	async function probeAvailability(): Promise<boolean> {
		try {
			availability.value = await deps.client.availability();
			return availability.value.agentAvailable === true;
		} catch {
			availability.value = null;
			return false;
		}
	}

	async function loadCurrent(): Promise<InterviewsCurrentLike | null> {
		try {
			return await deps.client.current();
		} catch (failure) {
			error.value = toFlowCode(codeOf(failure));
			phase.value = 'unavailable';
			return null;
		}
	}

	type InterviewsCurrentLike = {
		interview: InterviewCurrent | null;
		reportId: string | null;
	};

	/**
	 * Enters the call view: mints the WebRTC conversation for the active
	 * interview before the live phase renders, so the grant (or a mint
	 * error) is settled by the time the page reacts to the phase. A mint
	 * failure never drops the interview itself — the poll keeps the state
	 * fresh and the live view shows the error.
	 */
	async function enterLive() {
		try {
			conversation.value = await deps.client.mintConversation();
			error.value = null;
		} catch (failure) {
			conversation.value = null;
			error.value = toFlowCode(codeOf(failure));
		}
		phase.value = 'live';
	}

	async function applyCurrent(result: InterviewsCurrentLike) {
		error.value = null;
		interview.value = result.interview;
		reportId.value = result.reportId;
		const current = result.interview;
		if (current === null) {
			conversation.value = null;
			consents.value = emptyConsents();
			phase.value = 'intro';
			return;
		}
		if (current.status === 'submitted') {
			conversation.value = null;
			consents.value = emptyConsents();
			phase.value = 'submitted';
			return;
		}
		// Active interview: live rows resume in the call view (a fresh
		// conversation is minted for them); demo rows are driven headlessly
		// by the verification path, never from this page.
		if (current.mode === 'live') {
			await enterLive();
			return;
		}
		phase.value = 'demo-active';
	}

	async function init() {
		phase.value = 'checking';
		// A finished (or headless demo) interview shows its outcome before
		// any availability gate: no conversation is attempted, and hiding a
		// completed report behind the unavailable state would strand the
		// owner. Resuming a live call still requires the agent below.
		const existing = await loadCurrent();
		if (
			existing !== null
			&& existing.interview !== null
			&& (existing.interview.status === 'submitted'
				|| existing.interview.mode === 'demo')
		) {
			await applyCurrent(existing);
			return;
		}
		if (!(await probeAvailability())) {
			if (availability.value === null) {
				// The probe itself failed (network): generic retryable state.
				phase.value = 'unavailable';
				return;
			}
			// Honest deployment state: the agent is not configured here, so
			// there is nothing to call and no fallback surface is offered.
			phase.value = 'agent-unavailable';
			return;
		}
		if (existing !== null) {
			await applyCurrent(existing);
		}
	}

	async function notifySession(user: SessionUser | null) {
		error.value = null;
		if (user === null) {
			phase.value = 'signed-out';
			interview.value = null;
			reportId.value = null;
			return;
		}
		if (user.role !== 'owner') {
			phase.value = 'staff';
			interview.value = null;
			reportId.value = null;
			return;
		}
		await init();
	}

	function beginConsent() {
		if (phase.value !== 'intro') {
			return;
		}
		phase.value = 'consent';
	}

	async function start() {
		if (phase.value !== 'consent') {
			return;
		}
		if (!canStart.value) {
			return;
		}
		error.value = null;
		try {
			const result = await deps.client.start();
			// applyCurrent routes into the live view and mints the
			// conversation — the mint therefore always follows the completed
			// consent gate, never preceding it.
			await applyCurrent({ interview: result.interview, reportId: null });
		} catch (failure) {
			const code = codeOf(failure);
			if (code === 'already_submitted' || code === 'interview_active') {
				const result = await loadCurrent();
				if (result !== null) {
					await applyCurrent(result);
				}
				return;
			}
			if (code === 'mode_unavailable') {
				// The agent configuration disappeared between the probe and
				// the start: show the honest unavailable state.
				phase.value = 'agent-unavailable';
				return;
			}
			error.value = toFlowCode(code);
		}
	}

	function notifyCallEnded() {
		if (phase.value !== 'live') {
			return;
		}
		// The grant is consumed once the page started (or failed to start)
		// the conversation; a restart mints a fresh one.
		conversation.value = null;
		phase.value = 'ended';
	}

	async function refresh() {
		if (
			phase.value !== 'live'
			&& phase.value !== 'ended'
			&& phase.value !== 'submitted'
		) {
			return;
		}
		try {
			const result = await deps.client.current();
			interview.value = result.interview;
			reportId.value = result.reportId;
			if (result.interview?.status === 'submitted') {
				phase.value = 'submitted';
			}
		} catch {
			// A brief network interruption should not disturb the call view;
			// the next poll retries.
		}
	}

	async function restart() {
		if (phase.value !== 'ended' && phase.value !== 'unavailable') {
			return;
		}
		await init();
	}

	return {
		phase,
		interview,
		reportId,
		consents,
		canStart,
		error,
		availability,
		conversation,
		research,
		assessment,
		notifySession,
		init,
		beginConsent,
		start,
		notifyCallEnded,
		refresh,
		restart,
	};
}
