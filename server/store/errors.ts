// Errors thrown by the store domain modules. `server/utils/http.ts` maps them
// onto the shared P0 error body, so messages here must stay fixed phrases that
// identify records by id — never transcript text, provider payloads or secrets.
export class StoreInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StoreInputError';
	}
}

/** A route path or child record that does not exist under its parent. */
export class StoreLookupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StoreLookupError';
	}
}

/** The session moved on before the write; carries the current revision. */
export class StaleSessionError extends Error {
	readonly currentRev: number;

	constructor(message: string, currentRev: number) {
		super(message);
		this.name = 'StaleSessionError';
		this.currentRev = currentRev;
	}
}

/** A stale artifact was submitted for an action that requires a fresh one. */
export class StaleArtifactError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StaleArtifactError';
	}
}

/** One idempotency key was reused with different input; the caller must retry. */
export class IdempotencyConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdempotencyConflictError';
	}
}
