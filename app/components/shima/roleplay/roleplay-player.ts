import type { ShimaRoleplayClipId } from './roleplay-clips';

/**
 * Playback state for the prerecorded fictional demo clips only. This seam is
 * deliberately free of interview state: playing a clip never touches
 * transcripts, answers or analysis, and the adapter never exposes the audio
 * stream anywhere. Nothing here captures microphone input or contacts any
 * provider; the only network access is the browser fetching the same-origin
 * static WAV when the visitor presses a play control.
 */
export type ShimaRoleplayStatus = 'idle' | 'playing' | 'unavailable';

export type ShimaRoleplayMediaEvent = 'ended' | 'error';

/**
 * Minimal media handle. The adapter owns the browser element; the player only
 * starts, stops and listens — it never reads the stream and never records.
 */
export type ShimaRoleplayMedia = {
	play(): Promise<void>;
	pause(): void;
	on(kind: ShimaRoleplayMediaEvent, handler: () => void): void;
	/** Release the element; late events from it must be ignored. */
	dispose(): void;
};

export type ShimaRoleplaySnapshot = Readonly<{
	status: Readonly<Record<ShimaRoleplayClipId, ShimaRoleplayStatus>>;
	/** Japanese notice while playback is unavailable; the text stays regardless. */
	notice: string;
}>;

export type ShimaRoleplayPlayer = {
	snapshot(): ShimaRoleplaySnapshot;
	subscribe(listener: () => void): () => void;
	/** Start one clip, or stop the clip that is already playing. */
	toggle(id: ShimaRoleplayClipId): Promise<void>;
	stopAll(): void;
};

export const shimaRoleplayUnavailableNotice =
	'この環境では録音を再生できません。文字表示はそのままご利用ください。';

export function createShimaRoleplayPlayer(
	openMedia: (id: ShimaRoleplayClipId) => ShimaRoleplayMedia | null,
): ShimaRoleplayPlayer {
	const status: Record<ShimaRoleplayClipId, ShimaRoleplayStatus> = {
		'answer-owner': 'idle',
		'intro-owner': 'idle',
		'question-shima': 'idle',
	};
	const active = new Map<
		ShimaRoleplayClipId,
		{ media: ShimaRoleplayMedia; token: number }
	>();
	const listeners = new Set<() => void>();
	let notice = '';
	let generation = 0;

	function emit() {
		for (const listener of [...listeners]) {
			listener();
		}
	}

	function release(id: ShimaRoleplayClipId) {
		const entry = active.get(id);
		if (entry) {
			active.delete(id);
			entry.media.pause();
			entry.media.dispose();
		}
	}

	function stop(id: ShimaRoleplayClipId) {
		release(id);
		if (status[id] === 'playing') {
			status[id] = 'idle';
		}
	}

	function markUnavailable(id: ShimaRoleplayClipId) {
		release(id);
		status[id] = 'unavailable';
		notice = shimaRoleplayUnavailableNotice;
		emit();
	}

	function stopAll() {
		for (const id of [...active.keys()]) {
			stop(id);
		}
	}

	async function toggle(id: ShimaRoleplayClipId) {
		if (status[id] === 'playing') {
			stop(id);
			emit();
			return;
		}
		stopAll();
		const token = ++generation;
		const media = openMedia(id);
		if (!media) {
			markUnavailable(id);
			return;
		}
		active.set(id, { media, token });
		media.on('ended', () => {
			if (active.get(id)?.token !== token) {
				return;
			}
			release(id);
			status[id] = 'idle';
			emit();
		});
		media.on('error', () => {
			if (active.get(id)?.token !== token) {
				return;
			}
			markUnavailable(id);
		});
		try {
			await media.play();
		} catch {
			if (active.get(id)?.token !== token) {
				return;
			}
			markUnavailable(id);
			return;
		}
		if (active.get(id)?.token !== token) {
			return;
		}
		status[id] = 'playing';
		notice = '';
		emit();
	}

	return {
		snapshot() {
			return { status: { ...status }, notice };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		toggle,
		stopAll,
	};
}
