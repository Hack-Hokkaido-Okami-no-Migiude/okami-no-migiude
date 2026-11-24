// Scribe v3 Live realtime adapter: connects the server relay to the fixed
// official socket, normalizes provider frames into the frozen event seam
// (partial / commit / closed), and enforces the bounded connection lifecycle.
// Only `committed_transcript` frames are final evidence candidates; partials
// (including keepalives) are display-only and never persisted. Provider
// frames are untrusted data: their text is copied into event fields verbatim
// but never treated as directions, and provider failure text is replaced with
// fixed phrases and fixed codes only.
import { type Clock, realClock } from './clock';
import {
	type ProviderErrorCode,
	VoiceError,
	normalizeProviderCode,
	providerErrorPhrase,
} from './errors';
import {
	SCRIBE_AUDIO_FORMAT,
	SCRIBE_COMMIT_STRATEGY,
	SCRIBE_ENABLE_LOGGING,
	SCRIBE_MODEL_ID,
	SCRIBE_SAMPLE_RATE,
	type VoiceLanguage,
	type VoiceProviderConfig,
} from './config';
import { type VoiceSocketLike, openNodeWebSocket } from './socket';
import { StageError } from '../../shared/p0/stages';
import { z } from 'zod';

/**
 * Normalized adapter events. `partial` is ephemeral (display only);
 * `commit` is the final text of one segment and the only persistable event;
 * `closed` terminates the epoch. `eventKey` is the 1-based index of the
 * committed segment within this epoch — stable, idempotent and independent of
 * transcript text, so persistence can dedupe on (session, epoch, eventKey).
 */
export type ScribeEvent =
	| { kind: 'partial'; epoch: string; text: string }
	| {
			kind: 'commit';
			epoch: string;
			eventKey: string;
			text: string;
			startMs: number | null;
			endMs: number | null;
	  }
	| {
			kind: 'closed';
			epoch: string;
			reason: ScribeCloseReason;
			providerCode: ProviderErrorCode | null;
	  };

export const SCRIBE_CLOSE_REASONS = [
	'stopped',
	'aborted',
	'idle_timeout',
	'session_cap',
	'provider_error',
	'provider_closed',
	'protocol_error',
] as const;
export type ScribeCloseReason = (typeof SCRIBE_CLOSE_REASONS)[number];

export type ScribeCloseInfo = {
	reason: ScribeCloseReason;
	providerCode: ProviderErrorCode | null;
};

/** Optional non-fatal notices (fixed codes only, never provider text). */
export type ScribeNotice = { code: 'retention_zero_not_applied' };

export type ScribeHandle = {
	readonly epoch: string;
	readonly language: VoiceLanguage;
	/** Forward one PCM chunk (16 kHz mono 16-bit). Throws when the epoch ended. */
	sendAudioChunk(audio: Uint8Array, options?: { commit?: boolean }): void;
	/**
	 * Commit the current segment exactly like the official SDK: an empty
	 * audio chunk with `commit: true`.
	 */
	commitSegment(): void;
	/**
	 * Resolve once the next commit for this segment arrives (true) or the
	 * bound passes (false). Does not close the epoch on timeout — the caller
	 * recovers with the typed answer form.
	 */
	awaitFinalCommit(timeoutMs?: number): Promise<boolean>;
	/** Idempotent local close (owner-initiated stop). */
	stop(): void;
	/** Hard close for external aborts (teardown, revoke, safety stop). */
	abort(): void;
	readonly closed: boolean;
	/** Resolves exactly once when the epoch is fully closed. */
	readonly done: Promise<ScribeCloseInfo>;
};

export type ConnectScribeOptions = {
	config: VoiceProviderConfig;
	language: VoiceLanguage;
	/** The active epoch id from the voice epoch registry. */
	epoch: string;
	onEvent: (event: ScribeEvent) => void;
	onNotice?: (notice: ScribeNotice) => void;
	signal?: AbortSignal;
	/** Test seam: dial a socket through this instead of the native client. */
	socketFactory?: (url: string, headers: Record<string, string>) => VoiceSocketLike;
	clock?: Clock;
};

const SessionStartedSchema = z.looseObject({
	message_type: z.literal('session_started'),
	session_id: z.string(),
	config: z
		.looseObject({
			enable_logging: z.boolean().optional(),
		})
		.optional(),
});

const PartialTranscriptSchema = z.looseObject({
	message_type: z.literal('partial_transcript'),
	text: z.string(),
});

const CommittedTranscriptSchema = z.looseObject({
	message_type: z.literal('committed_transcript'),
	text: z.string(),
});

/** Documented non-error message types; never reinterpreted as failures. */
const informationTypes = new Set<string>([
	'session_started',
	'partial_transcript',
	'committed_transcript',
	'committed_transcript_with_timestamps',
	'diarized_transcript',
	'speakers_merged',
	'speaker_names',
	'committed_transcript_entities',
	'redacted_transcript',
	'edited_transcript',
	'warning',
	'final_transcript',
]);

/**
 * Connect the relay to the realtime transcription socket and resolve once the
 * provider confirms `session_started`. Fails closed with `provider_failed`
 * when the handshake or the start confirmation does not arrive in time.
 * Nothing is emitted through `onEvent` for a connection that never started.
 */
export async function connectScribeSession(options: ConnectScribeOptions): Promise<ScribeHandle> {
	const connection = new ScribeConnection(options);
	await connection.connect();
	return connection.handle();
}

type FinalizeWaiter = { resolve: (arrived: boolean) => void };
type TimerHandle = { clear(): void };

class ScribeConnection {
	private readonly options: ConnectScribeOptions;
	private readonly clock: Clock;
	private socket: VoiceSocketLike | null = null;
	private started = false;
	private closed = false;
	private closeInfo: ScribeCloseInfo | null = null;
	private readonly donePromise: Promise<ScribeCloseInfo>;
	private doneSettle: ((info: ScribeCloseInfo) => void) | null = null;
	private readonly startPromise: Promise<void>;
	private startSettle: (() => void) | null = null;
	private startReject: ((error: StageError) => void) | null = null;
	private commitCount = 0;
	private unknownFrames = 0;
	private openTimer: TimerHandle | null = null;
	private idleTimer: TimerHandle | null = null;
	private sessionTimer: TimerHandle | null = null;
	private signalListener: (() => void) | null = null;
	private pendingProviderCode: ProviderErrorCode | null = null;
	private finalizeWaiters: FinalizeWaiter[] = [];

	constructor(options: ConnectScribeOptions) {
		this.options = options;
		this.clock = options.clock ?? realClock;
		this.startPromise = new Promise<void>((resolve, reject) => {
			this.startSettle = resolve;
			this.startReject = reject;
		});
		this.donePromise = new Promise<ScribeCloseInfo>((resolve) => {
			this.doneSettle = resolve;
		});
	}

	/** Dial, wire, and wait for the provider's start confirmation. */
	async connect(): Promise<void> {
		const { config, language } = this.options;
		const query = new URLSearchParams({
			model_id: SCRIBE_MODEL_ID,
			audio_format: SCRIBE_AUDIO_FORMAT,
			commit_strategy: SCRIBE_COMMIT_STRATEGY,
			language_code: language,
			enable_logging: String(SCRIBE_ENABLE_LOGGING),
		});
		// The base URL is treated as an origin: the fixed endpoint path is
		// always appended exactly once, whatever the override carried.
		const wsOrigin = new URL(config.baseWsUrl).origin;
		const url = `${wsOrigin}/v1/speech-to-text/realtime?${query.toString()}`;
		const socket = (this.options.socketFactory ?? openNodeWebSocket)(url, {
			'xi-api-key': config.apiKey,
		});
		this.socket = socket;
		socket.onText((text) => {
			this.handleFrame(text);
		});
		socket.onClose(() => {
			this.onSocketClosed();
		});
		socket.onError(() => {
			// Before the start, an error means the handshake failed; after the
			// start, the close event is the terminal transition (an undici
			// WebSocket always follows an error with close).
			if (!this.started && !this.closed) {
				this.failBeforeStart('The live transcription connection could not be established.');
			}
		});
		if (this.options.signal) {
			this.signalListener = () => {
				this.close('aborted', null);
			};
			this.options.signal.addEventListener('abort', this.signalListener, { once: true });
		}
		this.openTimer = this.clock.setTimeout(() => {
			if (!this.started && !this.closed) {
				this.failBeforeStart('The live transcription connection was not confirmed in time.');
			}
		}, config.timeouts.socketOpenMs);
		await this.startPromise;
	}

	/** The frozen handle exposed to the guarded route. */
	handle(): ScribeHandle {
		const connection = {
			sendAudioChunk: (audio: Uint8Array, sendOptions?: { commit?: boolean }): void => {
				this.sendAudioChunk(audio, sendOptions);
			},
			commitSegment: (): void => {
				this.commitSegment();
			},
			awaitFinalCommit: (timeoutMs?: number): Promise<boolean> => {
				return this.awaitFinalCommit(timeoutMs);
			},
			stop: (): void => {
				this.close('stopped', null);
			},
			abort: (): void => {
				this.close('aborted', null);
			},
		};
		const closedNow = (): boolean => this.closed;
		return {
			epoch: this.options.epoch,
			language: this.options.language,
			sendAudioChunk: (audio, sendOptions) => connection.sendAudioChunk(audio, sendOptions),
			commitSegment: () => connection.commitSegment(),
			awaitFinalCommit: (timeoutMs) => connection.awaitFinalCommit(timeoutMs),
			stop: () => connection.stop(),
			abort: () => connection.abort(),
			get closed() {
				return closedNow();
			},
			done: this.donePromise,
		};
	}

	private handleFrame(text: string): void {
		if (this.closed) {
			// Late frames after any close are discarded unconditionally.
			return;
		}
		if (text.length > this.options.config.caps.maxInboundFrameChars) {
			this.close('protocol_error', null);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			this.unknownFrames += 1;
			return;
		}
		if (typeof parsed !== 'object' || parsed === null) {
			this.unknownFrames += 1;
			return;
		}
		const message = parsed as Record<string, unknown>;
		const messageType = typeof message.message_type === 'string' ? message.message_type : '';
		if (!this.started) {
			this.handlePreStartFrame(messageType, message);
			return;
		}
		if (messageType === 'partial_transcript') {
			const partial = PartialTranscriptSchema.safeParse(message);
			if (partial.success) {
				this.options.onEvent({
					kind: 'partial',
					epoch: this.options.epoch,
					text: partial.data.text,
				});
			} else {
				this.unknownFrames += 1;
			}
			return;
		}
		if (messageType === 'committed_transcript') {
			const committed = CommittedTranscriptSchema.safeParse(message);
			if (!committed.success) {
				this.close('protocol_error', null);
				return;
			}
			this.commitCount += 1;
			this.options.onEvent({
				kind: 'commit',
				epoch: this.options.epoch,
				eventKey: String(this.commitCount),
				text: committed.data.text,
				// The plain committed event carries no timestamps; times stay null.
				startMs: null,
				endMs: null,
			});
			this.settleFinalizeWaiters(true);
			return;
		}
		if (warningTypes.has(messageType)) {
			// Non-fatal provider notice: zero retention was requested but not
			// applied, so the session remains logged. The session continues;
			// only the fixed notice code is surfaced, never provider text.
			this.options.onNotice?.({ code: 'retention_zero_not_applied' });
			return;
		}
		if (!informationTypes.has(messageType) && hasErrorField(message)) {
			// Any documented error frame closes the epoch. The provider's own
			// error string is never read, logged, or echoed.
			const code = normalizeProviderCode(messageType);
			console.error(`[shima-voice] provider reported ${code}; closing the epoch.`);
			this.close('provider_error', code);
			return;
		}
		// Unknown or not-yet-supported frames (diarization variants, entity
		// events, legacy final_transcript, …) are ignored: they are never
		// turn finals here, and untrusted content is never acted on.
		this.unknownFrames += 1;
	}

	private handlePreStartFrame(messageType: string, message: Record<string, unknown>): void {
		if (messageType === 'session_started') {
			const session = SessionStartedSchema.safeParse(message);
			if (!session.success) {
				this.failBeforeStart('The provider session confirmation was not usable.');
				return;
			}
			if (session.data.config?.enable_logging === true) {
				this.options.onNotice?.({ code: 'retention_zero_not_applied' });
			}
			this.openTimer?.clear();
			this.openTimer = null;
			this.started = true;
			this.startSessionTimers();
			this.startSettle?.();
			this.startSettle = null;
			this.startReject = null;
			return;
		}
		if (!informationTypes.has(messageType) && hasErrorField(message)) {
			const code = normalizeProviderCode(messageType);
			console.error(`[shima-voice] provider rejected the connection (${code}).`);
			this.failBeforeStart(providerErrorPhrase(code));
			return;
		}
		this.unknownFrames += 1;
	}

	private onSocketClosed(): void {
		if (this.closed) {
			return;
		}
		if (!this.started) {
			this.failBeforeStart('The live transcription connection closed before it was confirmed.');
			return;
		}
		const providerCode = this.pendingProviderCode;
		this.pendingProviderCode = null;
		const reason = providerCode !== null ? 'provider_error' : 'provider_closed';
		this.close(reason, providerCode);
	}

	private startSessionTimers(): void {
		const { timeouts } = this.options.config;
		this.scheduleIdleTimer();
		this.sessionTimer = this.clock.setTimeout(() => {
			this.close('session_cap', null);
		}, timeouts.maxSessionMs);
	}

	private scheduleIdleTimer(): void {
		this.idleTimer?.clear();
		this.idleTimer = this.clock.setTimeout(() => {
			// Nothing has been forwarded at all: close on our own terms before
			// the provider's 15-second no-client-message limit does it for us.
			this.close('idle_timeout', null);
		}, this.options.config.timeouts.idleAudioMs);
	}

	private touchActivity(): void {
		if (this.closed) {
			return;
		}
		this.scheduleIdleTimer();
	}

	private sendAudioChunk(audio: Uint8Array, sendOptions?: { commit?: boolean }): void {
		if (this.closed || this.socket === null) {
			throw new VoiceError('epoch_not_active', 'The live transcription epoch is not active.');
		}
		if (audio.byteLength > this.options.config.caps.maxAudioChunkBytes) {
			throw new VoiceError('chunk_too_large', 'The audio chunk exceeds the relay size cap.');
		}
		const frame = {
			message_type: 'input_audio_chunk',
			audio_base_64: Buffer.from(audio).toString('base64'),
			commit: sendOptions?.commit === true,
			sample_rate: SCRIBE_SAMPLE_RATE,
		};
		this.sendFrame(JSON.stringify(frame));
	}

	private commitSegment(): void {
		if (this.closed || this.socket === null) {
			throw new VoiceError('epoch_not_active', 'The live transcription epoch is not active.');
		}
		// Mirrors the official SDK: an empty audio chunk with commit=true.
		const frame = {
			message_type: 'input_audio_chunk',
			audio_base_64: '',
			commit: true,
			sample_rate: SCRIBE_SAMPLE_RATE,
		};
		this.sendFrame(JSON.stringify(frame));
	}

	private sendFrame(text: string): void {
		const socket = this.socket;
		if (socket === null || this.closed) {
			throw new VoiceError('epoch_not_active', 'The live transcription epoch is not active.');
		}
		try {
			socket.send(text);
		} catch {
			this.close('provider_closed', null);
			throw new VoiceError('epoch_not_active', 'The live transcription epoch ended while sending.');
		}
		this.touchActivity();
	}

	private awaitFinalCommit(timeoutMs?: number): Promise<boolean> {
		const bound = timeoutMs ?? this.options.config.timeouts.finalizeWaitMs;
		if (this.closed) {
			return Promise.resolve(false);
		}
		return new Promise((resolve) => {
			const waiter: FinalizeWaiter = { resolve };
			this.finalizeWaiters.push(waiter);
			this.clock.setTimeout(() => {
				const index = this.finalizeWaiters.indexOf(waiter);
				if (index !== -1) {
					this.finalizeWaiters.splice(index, 1);
					waiter.resolve(false);
				}
			}, bound);
		});
	}

	private settleFinalizeWaiters(arrived: boolean): void {
		const waiters = this.finalizeWaiters;
		this.finalizeWaiters = [];
		for (const waiter of waiters) {
			waiter.resolve(arrived);
		}
	}

	private close(reason: ScribeCloseReason, providerCode: ProviderErrorCode | null): void {
		if (this.closed) {
			return;
		}
		if (!this.started) {
			this.failBeforeStart(providerFailureMessage(reason));
			return;
		}
		this.closed = true;
		this.clearTimers();
		const socket = this.socket;
		this.socket = null;
		if (socket !== null) {
			// Best-effort close; the relay stops forwarding immediately either
			// way, and the provider ends an idle socket within its own limit.
			socket.close(1000, 'shima epoch ended');
		}
		if (this.signalListener && this.options.signal) {
			this.options.signal.removeEventListener('abort', this.signalListener);
			this.signalListener = null;
		}
		this.settleFinalizeWaiters(false);
		this.closeInfo = { reason, providerCode };
		this.options.onEvent({
			kind: 'closed',
			epoch: this.options.epoch,
			reason,
			providerCode,
		});
		this.startSettle?.();
		this.doneSettle?.(this.closeInfo);
		this.doneSettle = null;
	}

	/**
	 * Failure before `session_started`: no handle exists yet, so the start
	 * promise rejects with the shared provider error dialect and NO event is
	 * emitted through `onEvent`.
	 */
	private failBeforeStart(message: string): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.clearTimers();
		const socket = this.socket;
		this.socket = null;
		if (socket !== null) {
			socket.close(1000, 'shima connect failed');
		}
		if (this.signalListener && this.options.signal) {
			this.options.signal.removeEventListener('abort', this.signalListener);
			this.signalListener = null;
		}
		this.settleFinalizeWaiters(false);
		this.closeInfo = { reason: 'provider_closed', providerCode: null };
		this.doneSettle?.(this.closeInfo);
		this.doneSettle = null;
		const reject = this.startReject;
		this.startSettle = null;
		this.startReject = null;
		reject?.(new StageError('provider_failed', message));
	}

	private clearTimers(): void {
		this.openTimer?.clear();
		this.openTimer = null;
		this.idleTimer?.clear();
		this.idleTimer = null;
		this.sessionTimer?.clear();
		this.sessionTimer = null;
	}
}

const warningTypes = new Set<string>(['warning']);

function hasErrorField(message: Record<string, unknown>): boolean {
	return typeof message.error === 'string';
}

function providerFailureMessage(reason: ScribeCloseReason): string {
	if (reason === 'aborted') {
		return 'The live transcription connection was aborted before it was confirmed.';
	}
	return 'The live transcription connection closed before it was confirmed.';
}
