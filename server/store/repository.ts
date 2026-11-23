// Local durable JSON store for the P0 slice: one versioned snapshot file, atomic
// same-directory writes, serialized read/modify/write commits, CAS on session rev.
// No in-memory fallback: every read hits disk and a malformed primary is never
// replaced with an empty store.
import type { Client, Id, Session } from '../../shared/p0/types';
import { ClientSchema, SessionSchema } from '../../shared/p0/schemas';
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeSync,
} from 'node:fs';
import path from 'node:path';

export type SessionKey = { clientId: Id; sessionId: Id };

/** Repository-internal record: the session plus per-artifact content keys. */
export type SessionRecord = {
	session: Session;
	keys: { discovery: string | null; proposals: Record<Id, string> };
};

export class StoreUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StoreUnavailableError';
	}
}

const SNAPSHOT_VERSION = 1;

type Snapshot = {
	version: number;
	clients: Record<Id, Client>;
	sessions: Record<string, SessionRecord>;
};

function emptySnapshot(): Snapshot {
	return { version: SNAPSHOT_VERSION, clients: {}, sessions: {} };
}

function dataDir(): string {
	const configured = process.env.NUXT_DATA_DIR?.trim();
	const directory =
		configured && configured.length > 0 ? configured : '.data';
	return path.resolve(process.cwd(), directory);
}

function snapshotFile(): string {
	return path.join(dataDir(), 'p0-store.json');
}

function snapshotKey(key: SessionKey): string {
	return `${key.clientId}/${key.sessionId}`;
}

function isSnapshotShape(value: unknown): value is Snapshot {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const snapshot = value as Snapshot;
	return (
		snapshot.version === SNAPSHOT_VERSION
		&& typeof snapshot.clients === 'object'
		&& snapshot.clients !== null
		&& typeof snapshot.sessions === 'object'
		&& snapshot.sessions !== null
	);
}

function parseRecord(record: unknown): SessionRecord {
	const candidate = record as SessionRecord;
	const session = SessionSchema.safeParse(candidate?.session);
	if (
		!session.success
		|| typeof candidate?.keys !== 'object'
		|| candidate.keys === null
	) {
		throw new StoreUnavailableError(
			'Persisted session failed schema validation; refusing to serve it.',
		);
	}
	const keys = candidate.keys;
	if (
		(typeof keys.discovery !== 'string' && keys.discovery !== null)
		|| typeof keys.proposals !== 'object'
		|| keys.proposals === null
	) {
		throw new StoreUnavailableError(
			'Persisted session keys are malformed.',
		);
	}
	return {
		session: session.data,
		keys: { discovery: keys.discovery, proposals: keys.proposals },
	};
}

function readSnapshot(): Snapshot {
	const file = snapshotFile();
	if (!existsSync(file)) {
		return emptySnapshot();
	}
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		throw new StoreUnavailableError('Data directory is not readable.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new StoreUnavailableError(
			'Persisted store is malformed; refusing to replace it.',
		);
	}
	if (!isSnapshotShape(parsed)) {
		throw new StoreUnavailableError(
			'Persisted store has an unexpected shape.',
		);
	}
	return parsed;
}

function writeSnapshotAtomic(snapshot: Snapshot): void {
	const directory = dataDir();
	const file = snapshotFile();
	try {
		mkdirSync(directory, { recursive: true });
	} catch {
		throw new StoreUnavailableError('Data directory is not writable.');
	}
	const tempFile = path.join(
		directory,
		`.p0-store.${process.pid}.${Date.now()}.tmp`,
	);
	const serialized = JSON.stringify(snapshot, null, '\t');
	let fileDescriptor: number | undefined;
	try {
		fileDescriptor = openSync(tempFile, 'w');
		writeSync(fileDescriptor, serialized);
		fsyncSync(fileDescriptor);
		closeSync(fileDescriptor);
		fileDescriptor = undefined;
		renameSync(tempFile, file);
	} catch (error) {
		if (fileDescriptor !== undefined) {
			try {
				closeSync(fileDescriptor);
			} catch {
				// best effort cleanup
			}
		}
		try {
			rmSync(tempFile, { force: true });
		} catch {
			// best effort cleanup
		}
		const errno = (error as NodeJS.ErrnoException).code;
		throw new StoreUnavailableError(
			errno === 'ENOSPC' ?
				'Data directory is out of space.'
			:	'Failed to persist the store.',
		);
	}
}

/** All mutating operations run through this queue; reads stay lock-free. */
let commitQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
	const run = commitQueue.then(operation);
	// A failed commit must not poison the queue for later callers.
	commitQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function validatedSession(session: Session): Session {
	const parsed = SessionSchema.safeParse(session);
	if (!parsed.success) {
		throw new StoreUnavailableError(
			'Attempted to persist a session that failed schema validation.',
		);
	}
	return parsed.data;
}

export async function readSession(
	key: SessionKey,
): Promise<SessionRecord | null> {
	const snapshot = readSnapshot();
	const record = snapshot.sessions[snapshotKey(key)];
	return record ? parseRecord(record) : null;
}

/**
 * Compare-and-swap the whole session: committed only when the stored revision
 * still equals `baseRev`. The store owns revision increments; returns `null`
 * when the session changed or was deleted concurrently.
 */
export async function casSession(
	key: SessionKey,
	baseRev: number,
	next: SessionRecord,
): Promise<SessionRecord | null> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		const sessionKey = snapshotKey(key);
		const current = snapshot.sessions[sessionKey];
		if (!current || current.session.rev !== baseRev) {
			return null;
		}
		const committed: SessionRecord = {
			session: validatedSession({ ...next.session, rev: baseRev + 1 }),
			keys: next.keys,
		};
		writeSnapshotAtomic({
			...snapshot,
			sessions: { ...snapshot.sessions, [sessionKey]: committed },
		});
		return committed;
	});
}

/**
 * Atomically insert the hotel demo seed when absent; otherwise return the
 * existing session untouched (no reset of edits or artifacts).
 */
export async function getOrCreateHotelDemo(seed: {
	client: Client;
	session: Session;
}): Promise<SessionRecord> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		const sessionKey = snapshotKey({
			clientId: seed.client.id,
			sessionId: seed.session.id,
		});
		const existing = snapshot.sessions[sessionKey];
		if (existing) {
			return parseRecord(existing);
		}
		const client = ClientSchema.parse(seed.client);
		const record: SessionRecord = {
			session: validatedSession({ ...seed.session, rev: 1 }),
			keys: { discovery: null, proposals: {} },
		};
		writeSnapshotAtomic({
			...snapshot,
			clients: { ...snapshot.clients, [client.id]: client },
			sessions: { ...snapshot.sessions, [sessionKey]: record },
		});
		return record;
	});
}
