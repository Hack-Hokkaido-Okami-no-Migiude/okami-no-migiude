// Store integration tests against the real JSON snapshot: client/session CRUD,
// CAS semantics, demo-seed idempotency, malformed-primary protection, and the
// shared session-mutation flow (cascade, staleness, no-op detection). Every
// test uses a fresh repo-local ignored data directory.
import {
	StaleSessionError,
	StoreInputError,
	StoreLookupError,
} from '../../server/store/errors';
import {
	StoreUnavailableError,
	casSession,
	createClient,
	createSession,
	getOrCreateHotelDemo,
	listClients,
	listSessions,
	readClient,
	readSession,
} from '../../server/store/repository';
import {
	answerRecord,
	client,
	evidence,
	makeSession,
	proposal,
	run,
	step,
	verifiedTextClaim,
} from './helpers/fixture';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { applyStepCorrection } from '../../server/store/corrections';
import assert from 'node:assert/strict';
import { buildSourceIndex } from '../../server/store/sources';
import { commitSessionMutation } from '../../server/store/commit-session';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);

function useFreshDataDir(): string {
	const directory = mkdtempSync(path.join(repoRoot, '.data', 'store-'));
	process.env.NUXT_DATA_DIR = directory;
	return directory;
}

test('client and session CRUD persist durably and stay scoped per client', async () => {
	useFreshDataDir();

	const created = await createClient('Acme Hotels');
	assert.match(created.id, /^cli_/);
	assert.deepEqual(await listClients(), [created]);
	assert.deepEqual(await readClient(created.id), created);
	assert.equal(await readClient('cli_nope'), null);

	const session = await createSession(created.id, 'Intake interview');
	assert.match(session.id, /^ses_/);
	assert.equal(session.clientId, created.id);
	assert.equal(session.rev, 1);
	assert.equal(session.transcript, null);
	assert.equal(session.origin, 'user');

	const other = await createClient('Other Co');
	const otherSession = await createSession(other.id, 'Other intake');
	const summaries = await listSessions(created.id);
	assert.deepEqual(
		summaries.map((entry) => [entry.id, entry.clientId, entry.rev]),
		[[session.id, created.id, 1]],
	);
	assert.equal(summaries.some((entry) => entry.id === otherSession.id), false);

	// Durable: a fresh read hits the snapshot on disk, not any memory.
	const reread = await readSession({
		clientId: created.id,
		sessionId: session.id,
	});
	assert.equal(reread?.session.title, 'Intake interview');

	await assert.rejects(
		() => createSession('cli_nope', 'Orphan session'),
		StoreLookupError,
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('casSession commits only on the expected revision and never retries', async () => {
	useFreshDataDir();
	const created = await createClient('Acme Hotels');
	const session = await createSession(created.id, 'Intake interview');
	const key = { clientId: created.id, sessionId: session.id };

	const committed = await casSession(key, 1, {
		session: { ...session, title: 'Renamed intake' },
		keys: { discovery: null, proposals: {} },
	});
	assert.equal(committed?.session.rev, 2);
	assert.equal(committed?.session.title, 'Renamed intake');

	const raced = await casSession(key, 1, {
		session: { ...session, title: 'Too late' },
		keys: { discovery: null, proposals: {} },
	});
	assert.equal(raced, null, 'a stale base revision must not commit');

	const unchanged = await readSession(key);
	assert.equal(unchanged?.session.title, 'Renamed intake');

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('getOrCreateHotelDemo inserts once and never resets committed edits', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_fixture', 'Fixture client'),
		session: makeSession({ clientId: 'cli_fixture', id: 'ses_fixture' }),
	};

	const first = await getOrCreateHotelDemo(seed);
	assert.equal(first.session.rev, 1);

	const bumped = await casSession(
		{ clientId: 'cli_fixture', sessionId: 'ses_fixture' },
		1,
		{
			session: { ...first.session, title: 'Edited by the consultant' },
			keys: { discovery: null, proposals: {} },
		},
	);
	assert.equal(bumped?.session.rev, 2);

	const second = await getOrCreateHotelDemo(seed);
	assert.equal(second.session.rev, 2);
	assert.equal(second.session.title, 'Edited by the consultant');

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('a malformed primary snapshot is never replaced with an empty store', async () => {
	const directory = useFreshDataDir();
	await createClient('Acme Hotels');
	const storeFile = path.join(directory, 'p0-store.json');
	assert.equal(existsSync(storeFile), true);

	writeFileSync(storeFile, '{"version": 1, "clients": {');
	assert.equal(readFileSync(storeFile, 'utf8').endsWith('{'), true);

	await assert.rejects(() => listClients(), StoreUnavailableError);
	await assert.rejects(() => createClient('Should not write'), StoreUnavailableError);
	assert.equal(
		readFileSync(storeFile, 'utf8').startsWith('{"version": 1, "clients": {'),
		true,
		'the malformed primary must stay untouched',
	);

	rmSync(directory, { recursive: true, force: true });
});

test('commitSessionMutation applies cascade, staleness, no-ops, and CAS', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_t1'),
		session: makeSession({
			discovery: run('fixture'),
			proposals: [proposal('opp_1', 'plan_1')],
		}),
	};
	await getOrCreateHotelDemo(seed);
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	// Transcript edit: cascade strips the invalidated citation, discovery and
	// the proposal (whose basis includes the graph) go stale, rev bumps.
	const afterEdit = await commitSessionMutation(key, 1, (current) => {
		const transcript = current.session.transcript;
		const segments = transcript
			? [
				{
					...transcript.segments[0],
					text: 'The clerk types every booking into the PMS by hand, slowly.',
					sourceRev: 2,
				},
				...transcript.segments.slice(1),
			]
			: [];
		return {
			session: {
				...current.session,
				transcript: { source: 'paste' as const, segments },
			},
		};
	}, { cascadeCitations: true });
	assert.equal(afterEdit.rev, 2);
	assert.equal(afterEdit.discovery?.stale, true);
	const editedStep1 = afterEdit.workflow.steps.find((entry) => entry.id === 'step_1');
	assert.equal(editedStep1?.label.value, null, 'invalidated citation reverts the claim to unknown');
	assert.equal(editedStep1?.graphEligible, false);
	assert.equal(
		afterEdit.proposals.every((entry) => entry.stale),
		true,
	);

	// Repeating the identical write is a no-op: no revision bump.
	const afterNoop = await commitSessionMutation(key, 2, (current) => ({
		session: current.session,
	}));
	assert.equal(afterNoop.rev, 2);

	// A wrong base revision is rejected with the current revision.
	await assert.rejects(
		() =>
			commitSessionMutation(key, 1, () => ({ session: null })),
		(error: unknown) =>
			error instanceof StaleSessionError && error.currentRev === 2,
	);

	// Unknown session -> 404-mapped lookup error.
	await assert.rejects(
		() =>
			commitSessionMutation(
				{ clientId: 'cli_t1', sessionId: 'ses_nope' },
				1,
				() => ({ session: null }),
			),
		StoreLookupError,
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('verified corrections survive a re-derivation and stale their dependents', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_t1'),
		session: makeSession({
			discovery: run('fixture'),
			proposals: [proposal('opp_1', 'plan_1')],
		}),
	};
	await getOrCreateHotelDemo(seed);
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	const afterCorrection = await commitSessionMutation(key, 1, (current) => {
		const corrected = step('step_1', verifiedTextClaim('Corrected label', [
			evidence('seg_src1', 1, 'types every booking into the PMS'),
		]), {
			role: {
				value: 'Senior clerk',
				state: 'consultant-verified',
				author: 'consultant',
				evidence: [evidence('seg_src1', 1, 'types every booking into the PMS')],
			},
		});
		return {
			session: {
				...current.session,
				workflow: {
					...current.session.workflow,
					steps: current.session.workflow.steps.map((entry) =>
						entry.id === 'step_1' ? corrected : entry,
					),
				},
			},
		};
	}, { forceDiscoveryStale: true });
	assert.equal(afterCorrection.rev, 2);
	assert.equal(afterCorrection.discovery?.stale, true);
	const corrected = afterCorrection.workflow.steps.find((entry) => entry.id === 'step_1');
	assert.equal(corrected?.label.state, 'consultant-verified');
	assert.equal(corrected?.label.author, 'consultant');
	assert.equal(corrected?.label.value, 'Corrected label');
	assert.equal(
		afterCorrection.proposals.every((entry) => entry.stale),
		true,
		'a graph change stales every dependent proposal',
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('boundary validation rejects a correction without evidence before any write', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_t1'),
		session: makeSession(),
	};
	await getOrCreateHotelDemo(seed);
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	await assert.rejects(
		() =>
			commitSessionMutation(key, 1, (current) => {
				const sources = buildSourceIndex(current.session);
				return {
					session: {
						...current.session,
						workflow: {
							...current.session.workflow,
							steps: current.session.workflow.steps.map((entry) =>
								entry.id === 'step_1'
									? applyStepCorrection(
										entry,
										{ label: { value: 'No evidence', evidence: [] } },
										false,
										sources,
									)
									: entry,
							),
						},
					},
				};
			}),
		StoreInputError,
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('answers are recorded with stable ids and edited in place', async () => {
	useFreshDataDir();
	const seed = {
		client: client('cli_t1'),
		session: makeSession(),
	};
	await getOrCreateHotelDemo(seed);
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	const first = await commitSessionMutation(key, 1, (current) => ({
		session: {
			...current.session,
			questions: current.session.questions.map((entry) =>
				entry.id === 'q_1'
					? { ...entry, status: 'answered' as const, answer: answerRecord('ans_x', 'It is YukiReserve.') }
					: entry,
			),
		},
	}));
	const answered = first.questions.find((entry) => entry.id === 'q_1');
	assert.equal(answered?.answer?.id, 'ans_x');
	assert.equal(answered?.answer?.sourceRev, 1);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});
