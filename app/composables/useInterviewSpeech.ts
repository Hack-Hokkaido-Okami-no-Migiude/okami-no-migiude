// Local speech synthesis (browser voice) for the scripted demo. This is the
// "labeled browser test substitute" for spoken prompts: it uses the browser's
// own speechSynthesis on the user's device, with visible text always shown
// alongside. No network service is involved. Injected deps keep it testable.
import { type Ref, getCurrentInstance, onUnmounted, ref } from 'vue';

export type SpeechSynthesisLike = {
	speak(utterance: unknown): void;
	cancel(): void;
};

type UtteranceLike = {
	text: string;
	lang: string;
	rate: number;
	onend: (() => void) | null;
};

type UtteranceCtor = new (text: string) => UtteranceLike;

export type SpeechController = {
	supported: Ref<boolean>;
	speaking: Ref<boolean>;
	/** Returns false when unsupported or when playback fails. */
	speak(text: string, locale: 'ja' | 'en'): boolean;
	cancel(): void;
};

export type SpeechDependencies = {
	synthesis?: SpeechSynthesisLike;
	UtteranceCtor?: UtteranceCtor;
	registerCleanup?: (fn: () => void) => void;
};

const LOCALE_TAGS: Record<'ja' | 'en', string> = {
	ja: 'ja-JP',
	en: 'en-US',
};

export function createInterviewSpeech(
	deps: SpeechDependencies,
): SpeechController {
	const supported = ref(Boolean(deps.synthesis && deps.UtteranceCtor));
	const speaking = ref(false);

	function cancel() {
		try {
			deps.synthesis?.cancel();
		} catch {
			// Cancellation is best-effort.
		}
		speaking.value = false;
	}

	function speak(text: string, locale: 'ja' | 'en'): boolean {
		if (
			!supported.value
			|| deps.synthesis === undefined
			|| deps.UtteranceCtor === undefined
		) {
			return false;
		}
		const utterance = new deps.UtteranceCtor(text);
		utterance.lang = LOCALE_TAGS[locale];
		utterance.rate = 0.95;
		utterance.onend = () => {
			speaking.value = false;
		};
		try {
			deps.synthesis.speak(utterance);
			speaking.value = true;
			return true;
		} catch {
			speaking.value = false;
			return false;
		}
	}

	deps.registerCleanup?.(cancel);

	return { supported, speaking, speak, cancel };
}

/** Registers `fn` to run on component unmount (no-op outside a setup). */
function cleanupOnUnmount(fn: () => void): void {
	if (getCurrentInstance() !== null) {
		onUnmounted(fn);
	}
}

/**
 * Page-level wrapper: wires the controller to the browser's own
 * speechSynthesis/Utterance and cancels any playback on unmount. On the
 * server (and in tests without deps) this resolves to the unsupported
 * controller where speak() simply returns false.
 */
export function useInterviewSpeech(): SpeechController {
	return createInterviewSpeech({
		synthesis:
			typeof window === 'undefined' ? undefined : window.speechSynthesis,
		UtteranceCtor:
			typeof window === 'undefined' ? undefined
				// Cast: the DOM ctor's onend carries a typed event param the
				// narrow UtteranceLike contract doesn't declare.
			: (window.SpeechSynthesisUtterance as unknown as UtteranceCtor),
		registerCleanup: cleanupOnUnmount,
	});
}
