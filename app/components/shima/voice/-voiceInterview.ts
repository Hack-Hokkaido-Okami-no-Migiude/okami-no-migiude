import { reactive, readonly } from 'vue';

export interface VoiceInput {
	available: boolean;
	consentComplete: boolean;
	notice: string;
	interviewPath: string;
	baseRev: number;
}

interface Relay {
	send(data: string | ArrayBuffer): void;
	close(): void;
}

interface Microphone {
	setEnabled(enabled: boolean): void;
	close(): void;
}

export interface VoiceIO {
	origin(): string;
	post(path: string, body: object): Promise<unknown>;
	connect(
		url: string,
		handlers: { message(data: unknown): void; disconnected(): void },
	): Relay;
	openMic(
		onChunk: (chunk: ArrayBuffer) => void,
		signal: AbortSignal,
	): Promise<Microphone>;
	play(url: string, signal: AbortSignal): Promise<void>;
	newId(): string;
}

interface Question {
	id: string;
	text: string;
}
export interface VoiceTurn {
	turnId: string;
	questionId: string;
	text: string;
}
export interface VoiceTurnRequest {
	baseRev: number;
	turn: VoiceTurn;
}
interface VoiceCallbacks {
	onRevision?: (rev: number) => void;
	commitTurn?: (
		turnsPath: string,
		request: VoiceTurnRequest,
	) => Promise<void>;
}

type Phase =
	| 'idle'
	| 'starting'
	| 'connecting'
	| 'permission'
	| 'listening'
	| 'finishing'
	| 'draft'
	| 'stopping';
interface Run {
	path: string;
	notice: string;
	rev: number;
	epoch?: string;
	ended: boolean;
	micAbort?: AbortController;
	playback?: AbortController;
	timer?: ReturnType<typeof setTimeout>;
	relay?: Relay;
	mic?: Microphone;
	stopRequest?: Promise<void>;
	approvedTurn?: Readonly<VoiceTurn>;
}

const interviewPathPattern =
	/^\/api\/clients\/[a-zA-Z0-9_-]+\/sessions\/[a-zA-Z0-9_-]+\/shima\/interview$/;
const isRevision = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const asObject = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' ?
		(value as Record<string, unknown>)
	:	{};
const disconnectedMessage =
	'音声接続が切れました。文字入力に切り替えられます。';

export function voiceAllowed(input: VoiceInput): boolean {
	return (
		input.available
		&& input.consentComplete
		&& !!input.notice.trim()
		&& interviewPathPattern.test(input.interviewPath)
	);
}

export function createVoiceInterview(
	input: () => VoiceInput,
	io: VoiceIO,
	callbacks: VoiceCallbacks = {},
) {
	const state = reactive({
		phase: 'idle' as Phase,
		question: null as Question | null,
		partial: '',
		draft: '',
		draftLocked: false,
		playing: false,
		saving: false,
		message: '',
		stopUnconfirmed: false,
	});
	let active: Run | undefined;
	let disposed = false;

	function isCurrent(run: Run) {
		const current = input();
		return (
			active === run
			&& !run.ended
			&& voiceAllowed(current)
			&& current.interviewPath === run.path
			&& current.notice === run.notice
		);
	}

	function releaseMic(run: Run) {
		run.micAbort?.abort();
		run.micAbort = undefined;
		run.mic?.close();
		run.mic = undefined;
	}

	function release(run: Run) {
		run.ended = true;
		clearTimeout(run.timer);
		releaseMic(run);
		run.playback?.abort();
		run.playback = undefined;
		run.relay?.close();
		run.relay = undefined;
		state.question = null;
		state.playing = false;
		state.saving = false;
		state.partial = '';
		state.draft = '';
		state.draftLocked = false;
		run.approvedTurn = undefined;
	}

	function reset(run: Run) {
		if (active === run) {
			active = undefined;
			state.phase = 'idle';
			state.stopUnconfirmed = false;
		}
	}

	function currentRevision(run: Run) {
		const current = input();
		return (
				current.interviewPath === run.path
					&& isRevision(current.baseRev)
			) ?
				Math.max(run.rev, current.baseRev)
			:	run.rev;
	}

	function stopEpoch(run: Run) {
		if (!run.epoch || run.stopRequest) {
			return run.stopRequest;
		}
		const epoch = run.epoch;
		const baseRev = currentRevision(run);
		state.stopUnconfirmed = false;
		const request = Promise.resolve().then(async () => {
			try {
				const reply = asObject(
					await io.post(`${run.path}/stop`, { baseRev, epoch }),
				);
				if (reply.stopped !== true || !isRevision(reply.rev)) {
					throw new Error('Unconfirmed stop');
				}
				reset(run);
				if (!disposed && input().interviewPath === run.path) {
					callbacks.onRevision?.(reply.rev);
				}
			} catch {
				state.stopUnconfirmed = true;
			} finally {
				run.stopRequest = undefined;
			}
		});
		run.stopRequest = request;
		return request;
	}

	async function stop(message?: string) {
		const run = active;
		if (!run) {
			return;
		}
		if (message) {
			state.message = message;
		}
		state.phase = 'stopping';
		release(run);
		await stopEpoch(run);
	}

	function dispose() {
		disposed = true;
		void stop();
	}

	function expectEvent(run: Run, message: string) {
		clearTimeout(run.timer);
		run.timer = setTimeout(() => {
			if (isCurrent(run)) {
				void stop(message);
			}
		}, 15_000);
	}

	function send(run: Run, data: string | ArrayBuffer) {
		try {
			if (!run.relay) {
				throw new Error('Relay closed');
			}
			run.relay.send(data);
			return true;
		} catch {
			void stop(disconnectedMessage);
			return false;
		}
	}

	function canCapture(run: Run) {
		return (
			isCurrent(run)
			&& state.phase === 'listening'
			&& !!state.question
			&& !state.playing
		);
	}

	async function openMic(run: Run) {
		clearTimeout(run.timer);
		state.phase = 'permission';
		const controller = new AbortController();
		run.micAbort = controller;
		try {
			const mic = await io.openMic((chunk) => {
				if (canCapture(run)) {
					send(run, chunk);
				}
			}, controller.signal);
			if (!isCurrent(run)) {
				mic.close();
				return;
			}
			run.mic = mic;
			state.phase = 'listening';
			mic.setEnabled(canCapture(run));
		} catch {
			if (isCurrent(run)) {
				void stop(
					'マイクを使用できません。文字入力に切り替えられます。',
				);
			}
		}
	}

	function playbackEnded(run: Run) {
		run.playback = undefined;
		if (
			state.playing
			&& !send(run, JSON.stringify({ type: 'playback', active: false }))
		) {
			return;
		}
		state.playing = false;
		run.mic?.setEnabled(canCapture(run));
	}

	async function presentQuestion(
		run: Run,
		question: Question,
		audioPath: unknown,
	) {
		state.question = question;
		state.partial = '';
		run.playback?.abort();
		let audioUrl: URL | undefined;
		if (typeof audioPath === 'string' && audioPath) {
			try {
				const origin = io.origin();
				const url = new URL(audioPath, `${origin}/`);
				if (
					url.origin === origin
					&& /^https?:$/.test(url.protocol)
					&& !url.username
					&& !url.password
				) {
					audioUrl = url;
				}
			} catch {
				/* The question remains available as text. */
			}
		}
		if (!audioUrl) {
			playbackEnded(run);
			return;
		}
		const alreadyPlaying = state.playing;
		state.playing = true;
		run.mic?.setEnabled(false);
		if (
			!alreadyPlaying
			&& !send(run, JSON.stringify({ type: 'playback', active: true }))
		) {
			return;
		}
		const playback = new AbortController();
		run.playback = playback;
		try {
			await io.play(audioUrl.href, playback.signal);
		} catch {
			/* Text is always shown. */
		}
		if (isCurrent(run) && run.playback === playback) {
			playbackEnded(run);
		}
	}

	function finish() {
		const run = active;
		if (!run || !canCapture(run)) {
			return;
		}
		state.phase = 'finishing';
		state.partial = '';
		releaseMic(run);
		if (send(run, JSON.stringify({ type: 'finish' }))) {
			expectEvent(
				run,
				'回答の下書きが届きませんでした。文字入力に切り替えられます。',
			);
		}
	}

	async function submit(text: string) {
		const run = active;
		const question = state.question;
		const reviewed = text.trim();
		if (
			!run
			|| !isCurrent(run)
			|| !question
			|| state.phase !== 'draft'
			|| state.saving
			|| !reviewed
			|| (run.approvedTurn && run.approvedTurn.text !== reviewed)
			|| !callbacks.commitTurn
		) {
			return;
		}
		state.saving = true;
		state.message = '';
		try {
			run.approvedTurn ??= Object.freeze({
				turnId: io.newId(),
				questionId: question.id,
				text: reviewed,
			});
			state.draftLocked = true;
			await callbacks.commitTurn(`${run.path}/turns`, {
				baseRev: currentRevision(run),
				turn: run.approvedTurn,
			});
			if (isCurrent(run)) {
				await stop('確認した回答を保存しました。');
			}
		} catch {
			if (isCurrent(run)) {
				state.message =
					'保存を確認できませんでした。確認した回答のまま再試行できます。';
			}
		} finally {
			if (isCurrent(run)) {
				state.saving = false;
			}
		}
	}

	function receive(run: Run, data: unknown) {
		if (!isCurrent(run) || typeof data !== 'string') {
			return;
		}
		let event: Record<string, unknown>;
		try {
			event = asObject(JSON.parse(data));
		} catch {
			return;
		}
		if (event.type === 'ready' && state.phase === 'connecting') {
			void openMic(run);
		}
		if (
			event.type === 'question'
			&& (state.phase === 'permission' || state.phase === 'listening')
		) {
			const question = asObject(event.question);
			if (
				typeof question.id === 'string'
				&& question.id
				&& typeof question.text === 'string'
				&& question.text
			) {
				void presentQuestion(
					run,
					{ id: question.id, text: question.text },
					event.audioPath,
				);
			}
		}
		if (
			event.type === 'partial'
			&& canCapture(run)
			&& typeof event.text === 'string'
		) {
			state.partial = event.text;
		}
		if (
			event.type === 'draft'
			&& state.phase === 'finishing'
			&& typeof event.text === 'string'
		) {
			clearTimeout(run.timer);
			state.draft = event.text;
			state.phase = 'draft';
		}
		if (event.type === 'stopped') {
			release(run);
			reset(run);
		}
		if (event.type === 'error') {
			void stop(
				'音声接続で問題が発生しました。文字入力に切り替えられます。',
			);
		}
	}

	async function start(acknowledged: boolean) {
		const current = input();
		if (
			!acknowledged
			|| disposed
			|| active
			|| !voiceAllowed(current)
			|| !isRevision(current.baseRev)
		) {
			return;
		}
		const run: Run = {
			path: current.interviewPath,
			notice: current.notice,
			rev: current.baseRev,
			ended: false,
		};
		active = run;
		state.message = '';
		state.phase = 'starting';
		try {
			const reply = asObject(
				await io.post(`${run.path}/start`, {
					baseRev: run.rev,
					confirmLiveVoice: true,
				}),
			);
			if (typeof reply.epoch === 'string' && reply.epoch) {
				run.epoch = reply.epoch;
			}
			if (!run.epoch || !isRevision(reply.rev)) {
				throw new Error('Invalid start response');
			}
			run.rev = reply.rev;
			if (!isCurrent(run)) {
				await stop();
				return;
			}
			callbacks.onRevision?.(run.rev);
			if (!isCurrent(run)) {
				await stop();
				return;
			}
			const url = new URL(`${run.path}/stream`, io.origin());
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			url.searchParams.set('epoch', run.epoch);
			state.phase = 'connecting';
			expectEvent(
				run,
				'音声接続の準備ができませんでした。文字入力に切り替えられます。',
			);
			run.relay = io.connect(url.href, {
				message: (data) => receive(run, data),
				disconnected: () => {
					if (isCurrent(run)) {
						void stop(disconnectedMessage);
					}
				},
			});
		} catch {
			const message =
				run.ended ? undefined : (
					'音声を開始できませんでした。文字入力に切り替えられます。'
				);
			if (run.epoch) {
				await stop(message);
			} else {
				if (message) {
					state.message = message;
				}
				reset(run);
			}
		}
	}

	return { state: readonly(state), start, stop, dispose, finish, submit };
}
