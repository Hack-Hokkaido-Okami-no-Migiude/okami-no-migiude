// Interview flow state machine: session gating, consent gate, start, resume,
// deadline hard cut, submit and restart. The API client and clock are
// injected so the whole machine is unit-testable without a browser build.
import { ApiFailure, type InterviewClient } from '../utils/interview-api.ts';
import { type ComputedRef, type Ref, computed, ref } from 'vue';
import {
	type ConsentsState,
	allConsentsGiven,
	emptyConsents,
} from '../utils/interview-consent.ts';
import type {
	InterviewCurrent,
	SessionUser,
} from '../../shared/types/domain.ts';
import {
	type TranscriptCheck,
	checkTranscript,
} from '../utils/interview-transcript.ts';
import {
	canAcceptEvent,
	parseDeadlineMs,
} from '../utils/interview-deadline.ts';
import type { DraftStore } from '../utils/interview-draft.ts';

export type FlowPhase =
	| 'checking'
	| 'unavailable'
	| 'signed-out'
	| 'staff'
	| 'intro'
	| 'consent'
	| 'active'
	| 'submitting'
	| 'submitted'
	| 'expired';

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
	transcript: Ref<string>;
	transcriptCheck: ComputedRef<TranscriptCheck>;
	deadlineAt: ComputedRef<string | null>;
	deadlinePassed: Ref<boolean>;
	draftRestored: Ref<boolean>;
	/** Applies the shell-provided session user and routes the phase. */
	notifySession(user: SessionUser | null): Promise<void>;
	init(): Promise<void>;
	beginConsent(): void;
	start(): Promise<void>;
	submit(): Promise<void>;
	/** Hard cut (idempotent); the timer's `passed` signal calls this. */
	markDeadlinePassed(): void;
	restart(): Promise<void>;
	onTranscriptInput(text: string): void;
	appendTranscript(text: string): boolean;
	replaceTranscript(text: string): boolean;
	clearTranscript(): void;
};

export type InterviewFlowDependencies = {
	client: InterviewClient;
	now?: () => number;
	draft?: DraftStore | null;
};

export function createInterviewFlow(
	deps: InterviewFlowDependencies,
): InterviewFlowController {
	const now = deps.now ?? (() => Date.now());
	const draft = deps.draft ?? null;

	const phase = ref<FlowPhase>('checking');
	const interview = ref<InterviewCurrent | null>(null);
	const reportId = ref<string | null>(null);
	const consents = ref<ConsentsState>(emptyConsents());
	const error = ref<FlowErrorCode | null>(null);
	const transcript = ref('');
	const deadlinePassed = ref(false);
	const draftRestored = ref(false);

	const deadlineAt = computed(() => interview.value?.deadlineAt ?? null);
	const deadlineMs = computed(() => {
		const value = deadlineAt.value;
		if (value === null) {
			return null;
		}
		try {
			return parseDeadlineMs(value);
		} catch {
			return null;
		}
	});
	const canStart = computed(() => allConsentsGiven(consents.value));
	const transcriptCheck = computed(() => checkTranscript(transcript.value));

	function codeOf(failure: unknown): string {
		if (failure instanceof ApiFailure) {
			return failure.code;
		}
		return 'network';
	}

	function toFlowCode(raw: string): FlowErrorCode {
		return (FLOW_ERROR_CODES.has(raw) ? raw : 'internal') as FlowErrorCode;
	}

	/** Cut as judged by the clock only (ignores the marked flag). */
	function clockCutActive(): boolean {
		const ms = deadlineMs.value;
		if (ms === null) {
			return false;
		}
		return !canAcceptEvent(ms, now());
	}

	/** True when the deadline has passed by the clock, or was marked passed. */
	function hardCutActive(): boolean {
		return deadlinePassed.value || clockCutActive();
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

	function applyCurrent(result: InterviewsCurrentLike) {
		error.value = null;
		interview.value = result.interview;
		reportId.value = result.reportId;
		const current = result.interview;
		if (current === null) {
			transcript.value = '';
			draftRestored.value = false;
			deadlinePassed.value = false;
			consents.value = emptyConsents();
			phase.value = 'intro';
			return;
		}
		if (current.status === 'submitted') {
			draftRestored.value = false;
			deadlinePassed.value = false;
			draft?.clear(current.id);
			phase.value = 'submitted';
			return;
		}
		// Active interview: resume with the locally saved draft.
		deadlinePassed.value = clockCutActive();
		const restored = draft ? draft.load(current.id) : '';
		draftRestored.value = restored.length > 0 && !deadlinePassed.value;
		transcript.value = deadlinePassed.value ? '' : restored;
		phase.value = deadlinePassed.value ? 'expired' : 'active';
	}

	async function init() {
		phase.value = 'checking';
		const result = await loadCurrent();
		if (result !== null) {
			applyCurrent(result);
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
		if (phase.value === 'intro') {
			// Route through the consent gate; with every acknowledgement already
			// recorded the gate may be passed straight through.
			phase.value = 'consent';
		}
		if (phase.value !== 'consent') {
			return;
		}
		if (!canStart.value) {
			return;
		}
		error.value = null;
		try {
			const result = await deps.client.start();
			interview.value = result.interview;
			reportId.value = null;
			deadlinePassed.value = false;
			draftRestored.value = false;
			transcript.value = '';
			phase.value = 'active';
		} catch (failure) {
			const code = codeOf(failure);
			if (code === 'already_submitted' || code === 'interview_active') {
				const result = await loadCurrent();
				if (result !== null) {
					applyCurrent(result);
				}
				return;
			}
			error.value = toFlowCode(code);
		}
	}

	async function submit() {
		if (phase.value !== 'active') {
			return;
		}
		const check = transcriptCheck.value;
		if (!check.ok) {
			return;
		}
		if (hardCutActive()) {
			// Hard cut re-checked immediately before accepting the submit.
			markDeadlinePassed();
			return;
		}
		const current = interview.value;
		if (current === null) {
			return;
		}
		error.value = null;
		phase.value = 'submitting';
		try {
			const result = await deps.client.complete(current.id, check.value);
			interview.value = result.interview;
			reportId.value = result.reportId;
			draft?.clear(current.id);
			transcript.value = '';
			draftRestored.value = false;
			deadlinePassed.value = false;
			phase.value = 'submitted';
		} catch (failure) {
			const code = codeOf(failure);
			if (code === 'already_submitted') {
				const result = await loadCurrent();
				if (result !== null) {
					applyCurrent(result);
				}
				return;
			}
			if (code === 'interview_expired') {
				deadlinePassed.value = true;
				draft?.clear(current.id);
				phase.value = 'expired';
				return;
			}
			error.value = toFlowCode(code);
			if (hardCutActive()) {
				deadlinePassed.value = true;
				draft?.clear(current.id);
				phase.value = 'expired';
			} else {
				phase.value = 'active';
			}
		}
	}

	function markDeadlinePassed() {
		const ms = deadlineMs.value;
		if (ms === null || now() < ms) {
			return;
		}
		if (deadlinePassed.value) {
			return;
		}
		deadlinePassed.value = true;
		draft?.clear(interview.value?.id ?? '');
		if (phase.value === 'active') {
			phase.value = 'expired';
		}
		// While submitting, the in-flight request decides the outcome.
	}

	async function restart() {
		if (phase.value !== 'expired') {
			return;
		}
		await init();
	}

	function onTranscriptInput(text: string) {
		if (hardCutActive()) {
			return;
		}
		transcript.value = text;
		const id = interview.value?.id;
		if (id !== undefined && draft !== null) {
			draft.save(id, text);
		}
	}

	function appendTranscript(text: string): boolean {
		if (hardCutActive()) {
			return false;
		}
		const trimmed = text.trim();
		if (trimmed.length === 0) {
			return false;
		}
		const current = transcript.value;
		transcript.value =
			current.length === 0 ? trimmed : `${current}\n${trimmed}`;
		const id = interview.value?.id;
		if (id !== undefined && draft !== null) {
			draft.save(id, transcript.value);
		}
		return true;
	}

	function replaceTranscript(text: string): boolean {
		if (hardCutActive()) {
			return false;
		}
		transcript.value = text;
		const id = interview.value?.id;
		if (id !== undefined && draft !== null) {
			draft.save(id, text);
		}
		return true;
	}

	function clearTranscript() {
		if (hardCutActive()) {
			return;
		}
		transcript.value = '';
		const id = interview.value?.id;
		if (id !== undefined && draft !== null) {
			draft.save(id, '');
		}
	}

	return {
		phase,
		interview,
		reportId,
		consents,
		canStart,
		error,
		transcript,
		transcriptCheck,
		deadlineAt,
		deadlinePassed,
		draftRestored,
		notifySession,
		init,
		beginConsent,
		start,
		submit,
		markDeadlinePassed,
		restart,
		onTranscriptInput,
		appendTranscript,
		replaceTranscript,
		clearTranscript,
	};
}
