// Per-interview transcript draft persistence. Uses sessionStorage by default
// in the browser (per tab, never leaves the device) with every storage
// failure swallowed — the draft is a convenience, never a requirement.
// Pure module with an injectable storage backend.

export type DraftStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
};

export type DraftStore = {
	load(interviewId: string): string;
	save(interviewId: string, text: string): void;
	clear(interviewId: string): void;
};

export function draftKey(interviewId: string): string {
	return `interview-draft:${interviewId}`;
}

export function createDraftStore(storage: DraftStorage): DraftStore {
	return {
		load(interviewId) {
			try {
				return storage.getItem(draftKey(interviewId)) ?? '';
			} catch {
				return '';
			}
		},
		save(interviewId, text) {
			try {
				storage.setItem(draftKey(interviewId), text);
			} catch {
				// Quota or privacy-mode failures are ignored by design.
			}
		},
		clear(interviewId) {
			try {
				storage.removeItem(draftKey(interviewId));
			} catch {
				// Ignored by design.
			}
		},
	};
}
