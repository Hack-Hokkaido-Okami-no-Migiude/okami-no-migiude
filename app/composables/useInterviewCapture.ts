// Microphone capture lifecycle. The recording is local-only and ephemeral:
// MediaRecorder runs in the browser, the audio never leaves the device, and
// the in-memory recording is discarded on stop/leave/deadline. There is no
// speech recognition here on purpose — transcript text is typed by the user
// (contract §11: no silent online recognition, no audio upload in the demo).
// All browser APIs are injected so unit tests can drive the lifecycle with
// fakes.
import {
	type ComputedRef,
	type Ref,
	computed,
	getCurrentInstance,
	onUnmounted,
	ref,
} from 'vue';
import { canAcceptEvent } from '../utils/interview-deadline.ts';

export type CapturePhase =
	'idle' | 'requesting' | 'recording' | 'error' | 'unsupported';

export type CaptureFailure =
	'denied' | 'not_found' | 'insecure' | 'unknown' | null;

export type CaptureStopReason =
	'user' | 'deadline' | 'unmount' | 'track_ended' | 'recorder_error';

export type CaptureController = {
	phase: Ref<CapturePhase>;
	failure: Ref<CaptureFailure>;
	/** Ephemeral in-page playback URL for the just-stopped recording. */
	reviewUrl: Ref<string | null>;
	supported: ComputedRef<boolean>;
	recording: ComputedRef<boolean>;
	/**
	 * Starts capture. Must be called from a real user gesture while consented
	 * and before the deadline; returns false (without touching the mic) when
	 * any precondition fails.
	 */
	start(deadlineMs: number | null): Promise<boolean>;
	stop(reason: CaptureStopReason): void;
	clearReview(): void;
};

export type CaptureDependencies = {
	getUserMedia?: (
		constraints: MediaStreamConstraints,
	) => Promise<MediaStream>;
	MediaRecorderCtor?: new (
		stream: MediaStream,
		options?: MediaRecorderOptions,
	) => MediaRecorder;
	createObjectUrl?: (blob: Blob) => string;
	revokeObjectUrl?: (url: string) => void;
	now?: () => number;
	registerCleanup?: (fn: () => void) => void;
};

function classifyFailure(error: unknown): CaptureFailure {
	const name =
		typeof error === 'object' && error !== null ?
			(error as { name?: unknown }).name
		:	undefined;
	if (name === 'NotAllowedError' || name === 'SecurityError') {
		return 'denied';
	}
	if (
		name === 'NotFoundError'
		|| name === 'OverconstrainedError'
		|| name === 'NotReadableError'
	) {
		return 'not_found';
	}
	return 'unknown';
}

export function createInterviewCapture(
	deps: CaptureDependencies,
): CaptureController {
	const {
		getUserMedia,
		MediaRecorderCtor,
		createObjectUrl,
		revokeObjectUrl,
	} = deps;
	const now = deps.now ?? (() => Date.now());
	const supported =
		Boolean(getUserMedia)
		&& Boolean(MediaRecorderCtor)
		&& Boolean(createObjectUrl);

	const phase = ref<CapturePhase>(supported ? 'idle' : 'unsupported');
	const failure = ref<CaptureFailure>(null);
	const reviewUrl = ref<string | null>(null);

	let stream: MediaStream | null = null;
	let recorder: MediaRecorderLike | null = null;
	let chunks: Blob[] = [];

	type MediaRecorderLike = {
		state: 'inactive' | 'recording' | 'paused';
		start(timesliceMs?: number): void;
		stop(): void;
		ondataavailable: ((event: { data: Blob }) => void) | null;
		onstop: (() => void) | null;
		onerror: ((event: { error: unknown }) => void) | null;
	};

	function releaseStream() {
		if (stream !== null) {
			for (const track of stream.getTracks()) {
				track.stop();
			}
			stream = null;
		}
	}

	function buildReview() {
		if (chunks.length === 0 || createObjectUrl === undefined) {
			return;
		}
		const blob = new Blob(chunks);
		chunks = [];
		reviewUrl.value = createObjectUrl(blob);
	}

	function finishStop() {
		recorder = null;
		releaseStream();
		buildReview();
		if (phase.value !== 'unsupported') {
			phase.value = 'idle';
		}
	}

	function stop(reason: CaptureStopReason) {
		void reason;
		const activeRecorder = recorder;
		recorder = null;
		if (activeRecorder !== null && activeRecorder.state !== 'inactive') {
			try {
				// Fake recorders fire onstop synchronously; real ones fire it
				// right after. Either way finishStop() completes the teardown.
				activeRecorder.stop();
				if (recorder !== null) {
					finishStop();
				}
			} catch {
				finishStop();
			}
		} else {
			finishStop();
		}
	}

	deps.registerCleanup?.(() => {
		const url = reviewUrl.value;
		if (url !== null && revokeObjectUrl !== undefined) {
			revokeObjectUrl(url);
			reviewUrl.value = null;
		}
		stop('unmount');
	});

	function dropReview() {
		const url = reviewUrl.value;
		if (url !== null && revokeObjectUrl !== undefined) {
			revokeObjectUrl(url);
		}
		reviewUrl.value = null;
	}

	async function start(deadlineMs: number | null): Promise<boolean> {
		if (!supported || getUserMedia === undefined) {
			return false;
		}
		if (phase.value === 'recording' || phase.value === 'requesting') {
			return false;
		}
		if (deadlineMs !== null && !canAcceptEvent(deadlineMs, now())) {
			return false;
		}
		failure.value = null;
		dropReview();
		phase.value = 'requesting';
		try {
			stream = await getUserMedia({ audio: true });
		} catch (error) {
			failure.value = classifyFailure(error);
			phase.value = 'error';
			return false;
		}
		if (MediaRecorderCtor === undefined) {
			// Unreachable when `supported` is true; kept as a guard.
			failure.value = 'unknown';
			phase.value = 'error';
			releaseStream();
			return false;
		}
		for (const track of stream.getTracks()) {
			track.addEventListener('ended', () => {
				stop('track_ended');
			});
		}
		chunks = [];
		const instance = new MediaRecorderCtor(
			stream,
		) as unknown as MediaRecorderLike;
		instance.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		instance.onstop = () => {
			finishStop();
		};
		instance.onerror = () => {
			stop('recorder_error');
		};
		recorder = instance;
		instance.start();
		phase.value = 'recording';
		return true;
	}

	return {
		phase,
		failure,
		reviewUrl,
		supported: computed(() => supported),
		recording: computed(() => phase.value === 'recording'),
		start,
		stop,
		clearReview: dropReview,
	};
}

/** Registers `fn` to run on component unmount (no-op outside a setup). */
function cleanupOnUnmount(fn: () => void): void {
	if (getCurrentInstance() !== null) {
		onUnmounted(fn);
	}
}

/**
 * Page-level wrapper: wires the controller to the real browser APIs and
 * releases the stream/recording on unmount. On the server no media APIs
 * exist, so this resolves to the disabled 'unsupported' controller.
 */
export function useInterviewCapture(): CaptureController {
	const mediaDevices =
		typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
	return createInterviewCapture({
		getUserMedia: mediaDevices?.getUserMedia?.bind(mediaDevices),
		MediaRecorderCtor:
			typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
		createObjectUrl:
			(
				typeof URL !== 'undefined'
				&& typeof URL.createObjectURL === 'function'
			) ?
				(blob: Blob) => URL.createObjectURL(blob)
			:	undefined,
		revokeObjectUrl:
			(
				typeof URL !== 'undefined'
				&& typeof URL.revokeObjectURL === 'function'
			) ?
				(url: string) => URL.revokeObjectURL(url)
			:	undefined,
		registerCleanup: cleanupOnUnmount,
	});
}
