import { type Clock, type ClockTimer, realClock } from '../voice/clock';
import { type InterviewGap, type InterviewQuestion, type InterviewTopic, type SelectedQuestion, selectInterviewQuestion } from './questions';

import type { ScribeEvent, ScribeHandle } from '../voice/scribe';
import type { ApprovedQuestion } from '../voice/tts';

const WARN_MS = 28 * 60_000;
const WRAP_MS = 30 * 60_000;
const STOP_MS = 35 * 60_000;
const FINAL_WAIT_MS = 5_000;
const MAX_TEXT = 16_000;
const MAX_SEGMENTS = 128;
const MAX_QUESTIONS = 100;
const MAX_CHUNK_BYTES = 64 * 1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

type StopReason = 'stopped' | 'revoked' | 'disconnected' | 'epoch_changed' | 'time_limit' | 'provider_failed';
type Operation = 'bind' | 'start-text' | 'connect' | 'audio' | 'finish' | 'tts' | 'commit';

export type InterviewEvent = { epoch: string } & (
	| { type: 'ready'; phase?: 'warning' | 'wrap' }
	| { type: 'question'; question: InterviewQuestion }
	| { type: 'partial' | 'draft'; text: string }
	| { type: 'stopped'; reason: StopReason }
	| { type: 'error'; code: 'provider_failed' | 'turn_too_long' }
);

export type InterviewTurnRequest = Readonly<{
	baseRev: number;
	turn: Readonly<{ turnId: string; questionId: string; text: string }>;
}>;
export type InterviewTurnCommit = InterviewTurnRequest & Readonly<{
	epoch: string;
	mode: 'text' | 'voice';
	signal: AbortSignal;
}>;

export class InterviewError extends Error {
	constructor(readonly code: 'inactive' | 'invalid_turn' | 'turn_busy') {
		super(code);
		this.name = 'InterviewError';
	}
}

type ConnectInput = { epoch: string; signal: AbortSignal; onEvent(event: ScribeEvent): void };
type Voice = Pick<ScribeHandle, 'sendAudioChunk' | 'commitSegment' | 'awaitFinalCommit' | 'abort'>;

export type InterviewOptions<Result> = {
	epoch: string;
	startedAtMs: number;
	mode: 'text' | 'voice';
	clock?: Clock;
	/** Authoritative binding: current epoch and still-connected principal/session. */
	isCurrent(epoch: string): boolean;
	/**
	 * Recheck access, epoch and applicable consent under the same boundary used by stop/revoke.
	 * Invoke perform synchronously inside that boundary if admitted; omit it to deny. Do not
	 * hold the lock for provider I/O. Stop/revoke must also call stop() on this instance.
	 * The admission mode is the epoch's original mode, even after switching to a typed turn.
	 */
	admit(request: { epoch: string; operation: Operation; mode: 'text' | 'voice'; signal: AbortSignal }, perform: () => void): void | Promise<void>;
	/** Already-authorized snapshot of the latest committed analysis, not a client input. */
	getGaps?(): readonly InterviewGap[];
	connect?(input: ConnectInput): Promise<Voice>;
	emit(event: InterviewEvent): void;
	onStop?(reason: StopReason): void;
	/** Recheck epoch/consent/signal atomically at durable CAS; dedupe by stable turnId. */
	commit(input: InterviewTurnCommit): Promise<Result>;
};

type Round = {
	selected: SelectedQuestion;
	controller: AbortController;
	mode: 'voice' | 'text';
	stage: 'opening' | 'listening' | 'finishing' | 'review' | 'saved';
	voice?: Voice;
	segments: string[];
	keys: Set<string>;
	chars: number;
	hadAudio: boolean;
	audioPending: boolean;
	playing: boolean;
	speechPending: boolean;
	saving: boolean;
	reviewed?: InterviewTurnRequest['turn'];
};

/** One coordinator per bound epoch; never rebind a stopped instance to a new connection. */
export class InterviewCoordinator<Result> {
	readonly epoch: string;
	private readonly options: InterviewOptions<Result>;
	private readonly clock: Clock;
	private readonly controller = new AbortController();
	private readonly asked = new Set<string>();
	private readonly timers: ClockTimer[] = [];
	private started = false;
	private ready = false;
	private rounds = 0;
	private round?: Round;

	constructor(options: InterviewOptions<Result>) {
		this.options = options;
		this.epoch = options.epoch;
		this.clock = options.clock ?? realClock;
	}

	get question(): InterviewQuestion | null {
		return this.active() && this.round && this.round.stage !== 'opening' ? { ...this.round.selected.question } : null;
	}

	async start(topic?: InterviewTopic): Promise<boolean> {
		if (this.started || !this.active()) {return false;}
		this.started = true;
		const elapsed = this.elapsed();
		if (elapsed < WARN_MS) {this.schedule(WARN_MS, () => this.emitTime('warning'));}
		if (elapsed < WRAP_MS) {this.schedule(WRAP_MS, () => this.emitTime('wrap'));}
		this.schedule(STOP_MS, () => this.stop('time_limit'));
		if (elapsed >= WRAP_MS) { this.stop('time_limit'); return false; }
		const opened = await this.openQuestion(topic, true);
		if (!opened) {this.stop();}
		return opened;
	}

	/** Skip or advance explicitly; socket generations prevent cross-question final segments. */
	async nextQuestion(topic?: InterviewTopic): Promise<boolean> {
		if (!this.active() || !this.round || this.round.saving
			|| this.round.stage === 'opening' || this.round.stage === 'finishing') {return false;}
		return this.openQuestion(topic, false);
	}

	repeatQuestion(): boolean {
		const round = this.round;
		if (!round || round.stage !== 'listening' || !this.liveRound(round) || this.elapsed() >= WRAP_MS) {return false;}
		this.emitQuestion(round);
		return true;
	}

	/** Route associates playback metadata with the current question before forwarding audio. */
	setPlayback(active: boolean): void {
		if (this.round?.stage === 'listening' && this.liveRound(this.round)) {this.round.playing = active;}
	}

	/** Speech contains only a static approved template; audio bytes/URL remain route-owned. */
	async speakQuestion<T>(questionId: string, speak: (question: ApprovedQuestion, signal: AbortSignal) => Promise<T>): Promise<T | null> {
		const round = this.round;
		if (!round || round.mode !== 'voice' || !this.liveRound(round) || round.stage !== 'listening'
			|| round.selected.question.id !== questionId || round.speechPending || this.elapsed() >= WRAP_MS) {return null;}
		round.speechPending = true;
		try {
			const result = await this.gate('tts', () => speak({
				questionId: round.selected.speechId, text: round.selected.question.text, language: 'ja',
			}, round.controller.signal), round, () => round.stage === 'listening' && this.elapsed() < WRAP_MS);
			if (!result) {return null;}
			const audio = await result.value;
			return this.liveRound(round) && round.stage === 'listening' ? audio : null;
		} catch {
			return null; // text remains available; no retry
		} finally {
			round.speechPending = false;
		}
	}

	/** No audio queue: backpressure drops frames while another admission is pending. */
	async forwardAudio(bytes: Uint8Array): Promise<boolean> {
		const round = this.round;
		if (!round || !this.canForward(round) || round.audioPending
			|| bytes.byteLength === 0 || bytes.byteLength % 2 !== 0 || bytes.byteLength > MAX_CHUNK_BYTES) {return false;}
		round.audioPending = true;
		try {
			// The adapter's idle timeout must not run during mic permission or question playback.
			const voice = round.voice ?? await this.connectVoice(round);
			if (!voice) {return false;}
			return !!(await this.gate('audio', () => {
				round.hadAudio = true;
				voice.sendAudioChunk(bytes);
			}, round, () => this.canForward(round)));
		} catch {
			this.providerFailed(round);
			return false;
		} finally {
			round.audioPending = false;
		}
	}

	async finishVoice(): Promise<boolean> {
		const round = this.round;
		if (!round || !this.canForward(round)) {return false;}
		const voice = round.voice;
		round.stage = 'finishing';
		try {
			if (voice && round.hadAudio) {
				const waiting = await this.gate('finish', () => {
					const final = voice.awaitFinalCommit(FINAL_WAIT_MS);
					voice.commitSegment();
					return final;
				}, round, () => round.stage === 'finishing');
				if (!waiting) {return false;}
				await waiting.value; // timeout still allows owner to review finals or type the missing text
			}
			if (!this.liveRound(round) || round.stage !== 'finishing') {return false;}
			this.presentDraft(round);
			return true;
		} catch {
			this.providerFailed(round);
			return false;
		}
	}

	/** Switch to typed review without any provider operation; partials are never a starting draft. */
	typeAnswer(): boolean {
		const round = this.round;
		if (!round || !this.liveRound(round) || (round.stage !== 'listening' && round.stage !== 'finishing')) {return false;}
		round.mode = 'text';
		this.presentDraft(round);
		return true;
	}

	async commitReviewed(input: InterviewTurnRequest): Promise<Result> {
		const round = this.round;
		if (!this.active() || !round) {throw new InterviewError('inactive');}
		if (round.saving) {throw new InterviewError('turn_busy');}
		const { turn, baseRev } = input;
		if ((round.stage !== 'review' && round.stage !== 'saved') || !Number.isSafeInteger(baseRev) || baseRev < 0
			|| turn.questionId !== round.selected.question.id || !uuid.test(turn.turnId)
			|| turn.text.length > MAX_TEXT || !turn.text.trim()
			|| (round.reviewed && (round.reviewed.turnId !== turn.turnId || round.reviewed.text !== turn.text))) {
			throw new InterviewError('invalid_turn');
		}
		const reviewed = Object.freeze({ turnId: turn.turnId, questionId: turn.questionId, text: turn.text });
		round.reviewed = reviewed;
		round.saving = true;
		try {
			const admitted = await this.gate('commit', () => this.options.commit({
				baseRev, turn: reviewed, epoch: this.epoch, mode: round.mode, signal: this.controller.signal,
			}), round);
			if (!admitted) {throw new InterviewError('inactive');}
			const result = await admitted.value;
			if (!this.liveRound(round)) {throw new InterviewError('inactive');}
			round.stage = 'saved';
			return result;
		} finally {
			round.saving = false;
		}
	}

	stop(reason: StopReason = 'stopped'): void {
		if (this.controller.signal.aborted) {return;}
		this.controller.abort();
		for (const timer of this.timers.splice(0)) {timer.clear();}
		if (this.round) {this.discard(this.round);}
		this.round = undefined;
		this.asked.clear();
		try {
			if (reason !== 'disconnected') {this.options.emit({ type: 'stopped', epoch: this.epoch, reason });}
		} finally {
			this.options.onStop?.(reason);
		}
	}

	private async openQuestion(topic: InterviewTopic | undefined, first: boolean): Promise<boolean> {
		if (this.elapsed() >= WRAP_MS || this.rounds >= MAX_QUESTIONS) {return false;}
		const selected = selectInterviewQuestion(this.options.getGaps?.() ?? [], this.asked, topic);
		if (!selected) {return false;}
		const prior = this.round;
		const round: Round = {
			selected, controller: new AbortController(), mode: prior?.mode ?? this.options.mode,
			stage: 'opening', segments: [], keys: new Set(), chars: 0, hadAudio: false,
			audioPending: false, playing: false, speechPending: false, saving: false,
		};
		this.round = round;
		if (prior) {this.discard(prior);}
		this.asked.add(selected.question.id);
		this.rounds++;
		try {
			const admitted = await this.gate(round.mode === 'voice' ? 'bind' : 'start-text', () => true, round);
			if (!admitted || !this.liveRound(round)) {return false;}
			if (this.elapsed() >= WRAP_MS) { this.stop('time_limit'); return false; }
			round.stage = 'listening';
			if (first) {
				this.ready = true;
				const elapsed = this.elapsed();
				if (elapsed >= WARN_MS) {this.emitTime('warning');}
				else {this.options.emit({ type: 'ready', epoch: this.epoch });}
			}
			if (!this.liveRound(round)) {return false;}
			this.emitQuestion(round);
			return true;
		} catch {
			this.providerFailed(round);
			return false;
		}
	}

	private async connectVoice(round: Round): Promise<Voice | null> {
		const connect = this.options.connect;
		if (!connect) {throw new InterviewError('inactive');}
		const admitted = await this.gate('connect', () => connect({
			epoch: this.epoch, signal: round.controller.signal, onEvent: event => this.onVoice(round, event),
		}), round, () => this.canForward(round));
		if (!admitted) {return null;}
		const voice = await admitted.value;
		if (!this.liveRound(round) || round.controller.signal.aborted) { voice.abort(); return null; }
		round.voice = voice;
		return voice;
	}

	private onVoice(round: Round, event: ScribeEvent): void {
		if (event.epoch !== this.epoch || round.controller.signal.aborted || !this.liveRound(round)) {return;}
		if (event.kind === 'closed') { this.stop('disconnected'); return; }
		if (!round.hadAudio || (round.stage !== 'listening' && round.stage !== 'finishing')) {return;}
		if (event.kind === 'partial') {
			if (round.stage === 'listening' && !round.playing && event.text.length <= MAX_TEXT) {
				this.options.emit({ type: 'partial', epoch: this.epoch, text: event.text });
			}
			return;
		}
		if (!event.eventKey || event.eventKey.length > 128 || round.keys.has(event.eventKey)) {return;}
		if (round.keys.size >= MAX_SEGMENTS || round.chars + event.text.length > MAX_TEXT) {
			try { this.options.emit({ type: 'error', epoch: this.epoch, code: 'turn_too_long' }); }
			finally { this.stop(); }
			return;
		}
		round.keys.add(event.eventKey);
		round.segments.push(event.text);
		round.chars += event.text.length;
	}

	private presentDraft(round: Round): void {
		round.stage = 'review';
		this.closeVoice(round);
		const text = round.segments.join('');
		round.segments = [];
		round.keys.clear();
		this.options.emit({ type: 'draft', epoch: this.epoch, text });
	}

	private canForward(round: Round): boolean {
		return this.liveRound(round) && round.mode === 'voice' && round.stage === 'listening' && !round.playing && !round.speechPending;
	}

	private emitQuestion(round: Round): void {
		this.options.emit({ type: 'question', epoch: this.epoch, question: { ...round.selected.question } });
	}

	private emitTime(phase: 'warning' | 'wrap'): void {
		if (this.ready && this.active()) {this.options.emit({ type: 'ready', epoch: this.epoch, phase });}
	}

	private elapsed(): number { return this.clock.now() - this.options.startedAtMs; }

	private schedule(deadline: number, action: () => void): void {
		this.timers.push(this.clock.setTimeout(action, Math.max(0, deadline - this.elapsed())));
	}

	private active(): boolean {
		if (this.controller.signal.aborted) {return false;}
		if (this.elapsed() >= STOP_MS) {this.stop('time_limit');}
		else if (!this.options.isCurrent(this.epoch)) {this.stop('epoch_changed');}
		return !this.controller.signal.aborted;
	}

	private liveRound(round: Round): boolean { return this.round === round && this.active(); }

	private closeVoice(round: Round): void {
		round.controller.abort();
		const voice = round.voice;
		round.voice = undefined;
		voice?.abort();
	}

	private discard(round: Round): void {
		this.closeVoice(round);
		round.segments = [];
		round.keys.clear();
		round.reviewed = undefined;
	}

	private providerFailed(round: Round): void {
		if (!this.liveRound(round)) {return;}
		try { this.options.emit({ type: 'error', epoch: this.epoch, code: 'provider_failed' }); }
		finally { this.stop('provider_failed'); }
	}

	private async gate<T>(operation: Operation, perform: () => T, round?: Round, canStart = () => true): Promise<{ value: T } | null> {
		const current = () => (round ? this.liveRound(round) : this.active()) && canStart();
		if (!current()) {return null;}
		const result: { work?: { value: T }; failure?: { error: unknown } } = {};
		let invoked = false;
		let pending = true;
		try {
			await this.options.admit({
				epoch: this.epoch, operation, mode: this.options.mode,
				signal: operation === 'commit' ? this.controller.signal : round?.controller.signal ?? this.controller.signal,
			}, () => {
				if (!pending || invoked) {return;}
				invoked = true;
				if (!current()) {return;}
				try {
					const value = perform();
					// A provider promise can reject while the authoritative lock is still unwinding.
					void Promise.resolve(value).catch(() => {});
					result.work = { value };
				} catch (error) { result.failure = { error }; }
			});
		} catch {
			if (current()) {this.stop('revoked');}
		}
		pending = false;
		if (!invoked && current()) {this.stop('revoked');}
		if (result.failure) {throw result.failure.error;}
		return result.work ?? null;
	}
}
