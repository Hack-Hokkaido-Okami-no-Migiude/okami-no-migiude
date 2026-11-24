// Local durable JSON store for the P0 slice: one versioned snapshot file, atomic
// same-directory writes, serialized read/modify/write commits, CAS on session rev.
// No in-memory fallback: every read hits disk and a malformed primary is never
// replaced with an empty store.
import type {
	Client,
	Id,
	Session,
	SessionSummary,
} from '../../shared/p0/types';
import {
	ClientSchema,
	SessionSchema,
	SessionSummarySchema,
} from '../../shared/p0/schemas';
import { IdempotencyConflictError, StoreLookupError } from './errors';
import type {
	ShimaSection,
	ShimaState,
	StoredAssignment,
	StoredQuest,
	StoredReceipt,
} from '../shima/storage';
import {
	ShimaSectionSchema,
	ShimaStateSchema,
	emptyShimaSection,
} from '../shima/storage';
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
import { newId } from './ids';
import path from 'node:path';
import { purgeShimaState } from '../shima/purge';

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
	/** Absent in stores written before the Shima tracer existed. */
	shima?: ShimaState;
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
	if (parsed.shima !== undefined && !ShimaStateSchema.safeParse(parsed.shima).success) {
		throw new StoreUnavailableError(
			'Persisted Shima state failed schema validation; refusing to serve it.',
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
		// Every session commit revalidates Shima citations against the new
		// session: purged sources take dependent Shima rows with them in the
		// same atomic write.
		const shima = purgeShimaState(snapshot.shima, sessionKey, committed.session);
		writeSnapshotAtomic({
			...snapshot,
			...(shima === undefined ? {} : { shima }),
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

// ---------------------------------------------------------------------------
// Client and session directory (user-created records; the demo seed inserts
// itself through getOrCreateHotelDemo)
// ---------------------------------------------------------------------------

export async function readClient(id: Id): Promise<Client | null> {
	return readSnapshot().clients[id] ?? null;
}

export async function listClients(): Promise<Client[]> {
	return Object.values(readSnapshot().clients);
}

/** Create a client with a server-assigned id; names are not unique. */
export async function createClient(name: string): Promise<Client> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		const client = ClientSchema.parse({ id: newId('cli'), name });
		writeSnapshotAtomic({
			...snapshot,
			clients: { ...snapshot.clients, [client.id]: client },
		});
		return client;
	});
}

/** Session summaries for one client, in creation order. */
export async function listSessions(clientId: Id): Promise<SessionSummary[]> {
	const snapshot = readSnapshot();
	return Object.values(snapshot.sessions)
		.filter((record) => record.session.clientId === clientId)
		.map((record) =>
			SessionSummarySchema.parse({
				id: record.session.id,
				clientId: record.session.clientId,
				title: record.session.title,
				rev: record.session.rev,
				origin: record.session.origin,
			}),
		);
}

/** Create an empty user session under an existing client. */
export async function createSession(
	clientId: Id,
	title: string,
): Promise<Session> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		if (!snapshot.clients[clientId]) {
			throw new StoreLookupError('Unknown client.');
		}
		const session: Session = validatedSession({
			id: newId('ses'),
			clientId,
			title,
			rev: 1,
			origin: 'user',
			transcript: null,
			workflow: { steps: [], edges: [] },
			questions: [],
			opportunities: [],
			proposals: [],
			discovery: null,
			reviewNotices: [],
		});
		writeSnapshotAtomic({
			...snapshot,
			sessions: {
				...snapshot.sessions,
				[snapshotKey({ clientId, sessionId: session.id })]: {
					session,
					keys: { discovery: null, proposals: {} },
				},
			},
		});
		return session;
	});
}

// ---------------------------------------------------------------------------
// Shima tracer rows: they share the snapshot file but keep their own section,
// their own revision, and their own commit entry points, so legacy data and
// legacy commits keep working unchanged.
// ---------------------------------------------------------------------------

export type ShimaView = {
	session: Session | null;
	/** The persisted run keys; empty defaults when the record is unknown. */
	keys: SessionRecord['keys'];
	section: ShimaSection;
	quests: Record<string, StoredQuest>;
	assignments: Record<string, StoredAssignment>;
};

export type ShimaBuildResult = {
	section: ShimaSection;
	/** false keeps the session revision (idempotent replays). */
	changed?: boolean;
	/** The response to store under the idempotency key; null stores nothing. */
	result: unknown;
	upsertQuests?: StoredQuest[];
	upsertAssignments?: StoredAssignment[];
};

export type ShimaCommit = {
	committed: boolean;
	view: ShimaView;
	/** The stored replay response when `committed` is false. */
	replayedResponse?: unknown;
	/** The build's `result` when `committed` is true. */
	result?: unknown;
};

export type QuestClaimOutcome =
	| { kind: 'replayed'; response: unknown }
	| { kind: 'missing' }
	| {
			kind: 'conflict';
			reason: 'already-claimed' | 'receipt-conflict';
	  }
	| { kind: 'conflict'; reason: 'stale-revision'; currentRev: number }
	| { kind: 'claimed'; quest: StoredQuest };

function shimaViewOf(snapshot: Snapshot, key: SessionKey): ShimaView {
	const sessionKey = snapshotKey(key);
	const record = snapshot.sessions[sessionKey];
	return {
		session: record ? record.session : null,
		keys: record ? record.keys : { discovery: null, proposals: {} },
		section: snapshot.shima?.sessions[sessionKey] ?? emptyShimaSection(),
		quests: snapshot.shima?.quests ?? {},
		assignments: snapshot.shima?.assignments ?? {},
	};
}

/** The session plus its Shima section; `session` is null when unknown. */
export async function readShimaView(key: SessionKey): Promise<ShimaView> {
	return shimaViewOf(readSnapshot(), key);
}

/**
 * Read one stored idempotency receipt without touching the write queue. Used
 * by routes that must recognize a replay before the request body can even be
 * fully validated (a degenerate replay body carries only the revision).
 */
export async function readShimaReceipt(
	key: SessionKey,
	route: string,
	idempotencyKey: string,
): Promise<StoredReceipt | null> {
	const snapshot = readSnapshot();
	const sessionKey = snapshotKey(key);
	const receiptId = `${route}|${idempotencyKey}`;
	return snapshot.shima?.sessions[sessionKey]?.receipts[receiptId] ?? null;
}

/** Every published quest, oldest first — the public board projection. */
export async function listQuests(): Promise<StoredQuest[]> {
	return Object.values(readSnapshot().shima?.quests ?? {}).sort((left, right) =>
		left.publishedAt < right.publishedAt ? -1 : left.publishedAt > right.publishedAt ? 1 : 0,
	);
}

export async function readQuest(questId: Id): Promise<StoredQuest | null> {
	return readSnapshot().shima?.quests[questId] ?? null;
}

/**
 * Commit one Shima mutation: the build sees the current view and returns the
 * next section (plus optional quest/assignment upserts and a receipt body).
 * The section revision is the caller's compare-and-swap base; the session
 * revision also advances so legacy routes can never interleave silently. All
 * of it lands in one atomic snapshot write.
 */
export async function commitShima(
	key: SessionKey,
	build: (view: ShimaView) => ShimaBuildResult,
	options: {
		receipt?: { route: string; key: string; fingerprint: string };
	} = {},
): Promise<ShimaCommit> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		const sessionKey = snapshotKey(key);
		const record = snapshot.sessions[sessionKey];
		if (!record) {
			throw new StoreLookupError('Unknown client or session.');
		}
		const view = shimaViewOf(snapshot, key);
		const receipt = options.receipt;
		const receiptId = receipt ? `${receipt.route}|${receipt.key}` : null;
		if (receipt && receiptId) {
			const existing = view.section.receipts[receiptId];
			if (existing) {
				if (existing.fingerprint !== receipt.fingerprint) {
					throw new IdempotencyConflictError(
						'The idempotency key was already used with different input.',
					);
				}
				return { committed: false, view, replayedResponse: existing.response };
			}
		}
		const built = build(view);
		const parsedSection = ShimaSectionParse(built.section, receiptId, receipt, built.result);
		const quests: Record<string, StoredQuest> = { ...(snapshot.shima?.quests ?? {}) };
		for (const quest of built.upsertQuests ?? []) {
			quests[quest.id] = quest;
		}
		const assignments: Record<string, StoredAssignment> = {
			...(snapshot.shima?.assignments ?? {}),
		};
		for (const assignment of built.upsertAssignments ?? []) {
			assignments[assignment.id] = assignment;
		}
		const state: ShimaState = {
			version: 1,
			sessions: { ...(snapshot.shima?.sessions ?? {}), [sessionKey]: parsedSection },
			quests,
			assignments,
		};
		// The section rev is the CAS for Shima writes; the session rev only
		// tracks session-level content, so a section write never bumps it.
		const session = record.session;
		const nextSnapshot: Snapshot = {
			...snapshot,
			shima: state,
			sessions: {
				...snapshot.sessions,
				[sessionKey]: { session, keys: record.keys },
			},
		};
		writeSnapshotAtomic(nextSnapshot);
		return {
			committed: true,
			view: shimaViewOf(nextSnapshot, key),
			result: built.result,
		};
	});
}

/**
 * Persist the built section, attaching the receipt when the build produced a
 * response. Rows were schema-parsed by the caller; the whole section is
 * validated again here so a route bug fails closed instead of persisting.
 */
function ShimaSectionParse(
	section: ShimaSection,
	receiptId: string | null,
	receipt: { route: string; fingerprint: string } | undefined,
	result: unknown,
): ShimaSection {
	const withReceipt =
		receiptId && receipt && result !== null && result !== undefined
			? {
					...section,
					receipts: {
						...section.receipts,
						[receiptId]: {
							route: receipt.route,
							fingerprint: receipt.fingerprint,
							response: result,
							createdAt: new Date().toISOString(),
						} satisfies StoredReceipt,
					},
				}
			: section;
	const parsed = ShimaSectionSchema.safeParse(withReceipt);
	if (!parsed.success) {
		throw new StoreUnavailableError(
			'Attempted to persist a Shima section that failed schema validation.',
		);
	}
	return parsed.data;
}

/**
 * Commit one quest claim: single winner by compare-and-swap on the quest
 * revision, receipt replay stored on the quest, and the engineer recorded
 * only as a key digest. Claims never touch a session.
 */
export async function commitQuestClaim(input: {
	questId: Id;
	baseRev: number;
	engineerKeyDigest: string;
	receipt: { key: string; fingerprint: string };
	buildResponse: (quest: StoredQuest) => unknown;
}): Promise<QuestClaimOutcome> {
	return enqueue(() => {
		const snapshot = readSnapshot();
		const shima = snapshot.shima;
		const quest = shima?.quests[input.questId];
		if (!quest) {
			return { kind: 'missing' as const };
		}
		const receiptId = `shima-claim|${input.receipt.key}`;
		const existing = quest.receipts[receiptId];
		if (existing) {
			return existing.fingerprint === input.receipt.fingerprint
				? { kind: 'replayed' as const, response: existing.response }
				: { kind: 'conflict' as const, reason: 'receipt-conflict' as const };
		}
		const mine =
			quest.state === 'claimed' && quest.assigneeId === input.engineerKeyDigest;
		// The claimed state is checked before the revision: a losing competitor
		// must always see `already_claimed`, and a same-engineer repeat replays
		// its existing claim, whatever revision it arrived with.
		if (quest.state === 'claimed' && !mine) {
			return { kind: 'conflict' as const, reason: 'already-claimed' as const };
		}
		if (!mine && quest.rev !== input.baseRev) {
			return {
				kind: 'conflict' as const,
				reason: 'stale-revision' as const,
				currentRev: quest.rev,
			};
		}
		const now = new Date().toISOString();
		const nextQuest: StoredQuest = mine
			? { ...quest }
			: {
					...quest,
					rev: quest.rev + 1,
					state: 'claimed',
					assigneeId: input.engineerKeyDigest,
					claimedAt: now,
				};
		const receiptRow: StoredReceipt = {
			route: 'shima-claim',
			fingerprint: input.receipt.fingerprint,
			response: input.buildResponse(nextQuest),
			createdAt: now,
		};
		const claimed: StoredQuest = {
			...nextQuest,
			receipts: { ...nextQuest.receipts, [receiptId]: receiptRow },
		};
		const state: ShimaState = {
			version: 1,
			sessions: shima?.sessions ?? {},
			quests: { ...(shima?.quests ?? {}), [input.questId]: claimed },
			assignments: {
				...(shima?.assignments ?? {}),
			},
		};
		writeSnapshotAtomic({ ...snapshot, shima: state });
		return { kind: 'claimed' as const, quest: claimed };
	});
}
