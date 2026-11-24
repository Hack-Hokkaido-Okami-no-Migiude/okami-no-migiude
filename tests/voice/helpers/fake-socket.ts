// In-process socket double implementing the transport seam: no network, and
// the test drives provider events (open / frames / close / error) explicitly.
import type { VoiceSocketLike } from '../../../server/voice/socket';

export class FakeSocket implements VoiceSocketLike {
	opened = false;
	sentTexts: string[] = [];
	closeCalls: Array<{ code: number; reason: string }> = [];
	private openCallbacks: Array<() => void> = [];
	private textCallbacks: Array<(text: string) => void> = [];
	private closeCallbacks: Array<(code: number) => void> = [];
	private errorCallbacks: Array<() => void> = [];

	send(text: string): void {
		if (this.closedByLocal) {
			throw new Error('send on closed socket');
		}
		this.sentTexts.push(text);
	}

	close(code: number, reason: string): void {
		this.closeCalls.push({ code, reason });
		this.closedByLocal = true;
	}

	private closedByLocal = false;

	onOpen(callback: () => void): void {
		this.openCallbacks.push(callback);
	}

	onText(callback: (text: string) => void): void {
		this.textCallbacks.push(callback);
	}

	onClose(callback: (code: number) => void): void {
		this.closeCallbacks.push(callback);
	}

	onError(callback: () => void): void {
		this.errorCallbacks.push(callback);
	}

	// ---- test controls ----

	serverOpen(): void {
		this.opened = true;
		for (const callback of [...this.openCallbacks]) {
			callback();
		}
	}

	serverText(text: string): void {
		for (const callback of [...this.textCallbacks]) {
			callback(text);
		}
	}

	serverJson(frame: unknown): void {
		this.serverText(JSON.stringify(frame));
	}

	serverClose(code = 1000): void {
		for (const callback of [...this.closeCallbacks]) {
			callback(code);
		}
	}

	serverError(): void {
		for (const callback of [...this.errorCallbacks]) {
			callback();
		}
	}
}
