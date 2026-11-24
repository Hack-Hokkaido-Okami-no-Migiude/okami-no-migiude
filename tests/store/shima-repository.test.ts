// Store-level tracer tests against the real JSON snapshot (runs with tsx, no
// server build needed): Shima sections coexist with legacy client/session data,
// every `casSession` commit atomically purges Shima rows whose cited sources
// moved, transcript deletion purges the section plus sourced quests and
// assignments in the same commit, malformed Shima sections fail closed without
// resetting the store, and pre-Shima stores read as empty and keep working.
import { EvidenceRefSchema, SessionSchema } from '../../shared/p0/schemas';
import {
	HOTEL_DEMO_CLIENT_ID,
	HOTEL_DEMO_FOLLOWUP_ANSWER,
	HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	createHotelFixtureProvider,
	hotelSeed,
} from '../../server/demo/hotel';
import type { Id, Session } from '../../shared/p0/types';
import {
	PUBLIC_TASK_SCHEMA_TAG,
	publicTaskHash,
} from '../../shared/shima/hash';
import {
	StoreUnavailableError,
	casSession,
	commitShima,
	createClient,
	createSession,
	getOrCreateHotelDemo,
	listClients,
	readClient,
	readSession,
	readShimaView,
} from '../../server/store/repository';
import {
	StoredAssignmentSchema,
	StoredEffortSchema,
	StoredPackageSchema,
	StoredPreviewSchema,
	StoredQuestSchema,
} from '../../server/shima/storage';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { SessionRecord } from '../../server/store/repository';
import assert from 'node:assert/strict';
import { discover } from '../../server/analysis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);
const DEMO_KEY = { clientId: HOTEL_DEMO_CLIENT_ID, sessionId: 'ses_hotel_demo' };
const ANY_ANSWER_ID = 'ans_store_test' as Id;
const ROOM_CHANGE_STEP_ID = 'step_hotel_08';

function useFreshDataDir(): string {
	const directory = mkdtempSync(path.join(repoRoot, '.data', 'shima-store-'));
	process.env.NUXT_DATA_DIR = directory;
	return directory;
}

function evidenceForAnswer(): { sourceId: Id; sourceRev: number; quote: string } {
	return EvidenceRefSchema.parse({
		sourceId: ANY_ANSWER_ID,
		sourceRev: 1,
		quote: HOTEL_DEMO_FOLLOWUP_ANSWER,
	});
}

function effortRow() {
	return StoredEffortSchema.parse({
		stepId: ROOM_CHANGE_STEP_ID,
		weeklyOccurrences: {
			kind: 'owner-reported',
			value: 10,
			basis: '繁忙期は週あたり約10件（オーナー報告）。',
			evidence: [evidenceForAnswer()],
		},
		minutesPerOccurrence: {
			kind: 'owner-reported',
			value: 15,
			basis: '電話と書き直しで1件あたり約15分（オーナー報告）。',
			evidence: [evidenceForAnswer()],
		},
		recordedAt: '2026-11-24T00:00:00.000Z',
	});
}

function packageRecord(id: Id, problemText: string) {
	return StoredPackageSchema.parse({
		package: {
			id,
			opportunityId: 'opp_hotel_02',
			draft: {
				title: 'Keep the housekeeping schedule current',
				problem: problemText,
				proposedChange: 'Post confirmed room changes to the shared schedule.',
				deliverables: ['A posting rule'],
				acceptanceCriteria: ['Posted within five minutes'],
				skills: [],
				integrations: [],
				benefits: ['No missed calls'],
				prerequisites: ['A shared schedule location'],
				limitations: ['High-season basis only'],
				proposedBudgetYen: null,
				targetDate: null,
			},
			basisKey: 'a'.repeat(64),
			evidence: [evidenceForAnswer()],
			state: 'draft',
			stale: false,
			decision: null,
			previewId: null,
			questId: null,
		},
		editedFields: [],
	});
}

function previewRecord(packageId: Id, previewId: Id) {
	const task = {
		title: '清掃シフト表を予約変更から自動更新する（ホテルYuki・架空デモ）',
		problem: '架空のデモ課題です。',
		proposedChange: '架空のデモ対応です。',
		deliverables: ['成果物'],
		acceptanceCriteria: ['受け入れ基準'],
		skills: ['スキル'],
		integrations: ['連携'],
		benefits: ['効果'],
		prerequisites: ['前提'],
		limitations: ['制限'],
		estimatedHoursSavedPerMonth: 10,
		confirmedBudgetYen: 80000,
		targetDate: '2026-12-18',
	};
	return StoredPreviewSchema.parse({
		preview: {
			id: previewId,
			hash: publicTaskHash(task),
			task,
		},
		packageId,
		basisKey: 'a'.repeat(64),
		catalogVersion: 1,
		createdAt: '2026-11-24T00:00:00.000Z',
	});
}

function questRecord(id: Id, source: { clientId: Id; sessionId: Id }) {
	return StoredQuestSchema.parse({
		id,
		rev: 1,
		state: 'available',
		task: previewRecord('pkg_any', 'prv_any').preview.task,
		catalogVersion: 1,
		packageId: 'pkg_any',
		source,
		publishedAt: '2026-11-24T00:00:00.000Z',
		receipts: {},
	});
}

function assignmentRecord(id: Id, questId: Id, digest: string) {
	return StoredAssignmentSchema.parse({
		id,
		questId,
		engineerKeyDigest: digest,
		claimedAt: '2026-11-24T00:00:00.000Z',
	});
}

/**
 * Seed the real demo session and drive it to the documented follow-up state
 * through the actual fixture analysis, committing via `casSession` so the
 * stored shape is exactly what the routes persist.
 */
async function seededFollowupRecord(): Promise<SessionRecord> {
	useFreshDataDir();
	const seeded = await getOrCreateHotelDemo(hotelSeed);
	const baseProvider = createHotelFixtureProvider(seeded.session);
	const base = await discover(seeded.session, baseProvider);
	let session: Session = { ...seeded.session, ...base.patch };
	const question = session.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	assert.ok(question);
	question.status = 'answered';
	question.answer = {
		id: ANY_ANSWER_ID,
		sourceRev: 1,
		text: HOTEL_DEMO_FOLLOWUP_ANSWER,
	};
	const followProvider = createHotelFixtureProvider(session);
	const follow = await discover(session, followProvider);
	session = { ...session, ...follow.patch };
	const committed = await casSession(DEMO_KEY, 1, {
		session,
		keys: { discovery: follow.artifactKey, proposals: {} },
	});
	assert.ok(committed, 'the seeded demo session must still be at rev 1');
	return committed;
}

test('Shima sections coexist with legacy client and session data', async () => {
	const record = await seededFollowupRecord();

	// Legacy user records are untouched by Shima writes.
	const client = await createClient('Acme Hotels');
	const session = await createSession(client.id, 'Intake interview');

	const before = await readShimaView(DEMO_KEY);
	assert.equal(before.section.rev, 1);
	assert.deepEqual(before.section.effort, {});

	await commitShima(DEMO_KEY, (view) => ({
		section: {
			...view.section,
			rev: view.section.rev + 1,
			effort: { [ROOM_CHANGE_STEP_ID]: effortRow() },
		},
		result: null,
	}));

	const after = await readShimaView(DEMO_KEY);
	assert.equal(after.section.rev, 2);
	assert.ok(after.section.effort[ROOM_CHANGE_STEP_ID]);
	assert.equal(after.session?.rev, 2);
	assert.equal((await listClients()).length, 2);
	assert.deepEqual(await readClient(client.id), client);
	assert.equal((await readSession({
		clientId: session.clientId,
		sessionId: session.id,
	}))?.session.title, 'Intake interview');
	assert.equal(record.session.id, 'ses_hotel_demo');

	// A later session commit preserves the Shima section untouched.
	const current = await readSession(DEMO_KEY);
	assert.ok(current);
	const retitled = await casSession(DEMO_KEY, current.session.rev, {
		session: { ...current.session, title: 'Retitled demo interview' },
		keys: current.keys,
	});
	assert.ok(retitled);
	const preserved = await readShimaView(DEMO_KEY);
	assert.equal(preserved.section.rev, 2);
	assert.ok(preserved.section.effort[ROOM_CHANGE_STEP_ID]);
	assert.equal(retitled.session.rev, 3);
});

test('a cited-source edit purges dependent effort and quote-bearing drafts atomically', async () => {
	await seededFollowupRecord();
	await commitShima(DEMO_KEY, (view) => ({
		section: {
			...view.section,
			rev: view.section.rev + 1,
			effort: { [ROOM_CHANGE_STEP_ID]: effortRow() },
			packages: {
				pkg_with_quote: packageRecord(
					'pkg_with_quote',
					`Copied source text: ${HOTEL_DEMO_FOLLOWUP_ANSWER}`,
				),
				pkg_without_quote: packageRecord(
					'pkg_without_quote',
					'Paraphrased plan prose without any source quote.',
				),
			},
			previews: {
				prv_with_quote: previewRecord('pkg_with_quote', 'prv_with_quote'),
			},
		},
		result: null,
	}));

	// Edit the saved answer the way the answer route would: same id, new rev.
	const current = await readSession(DEMO_KEY);
	assert.ok(current);
	const answered = current.session.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	assert.ok(answered?.answer);
	const editedSession: Session = {
		...current.session,
		questions: current.session.questions.map((entry) =>
			entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID ?
				{
					...entry,
					answer: {
						...entry.answer,
						sourceRev: 2,
						text: `${entry.answer.text} (edited)`,
					},
				}
			:	entry,
		),
	};
	const committed = await casSession(DEMO_KEY, current.session.rev, {
		session: editedSession,
		keys: current.keys,
	});
	assert.ok(committed);

	const after = await readShimaView(DEMO_KEY);
	assert.equal(after.section.effort[ROOM_CHANGE_STEP_ID], undefined);
	assert.equal(after.section.packages['pkg_with_quote'], undefined);
	assert.equal(after.section.previews['prv_with_quote'], undefined);
	// The paraphrasing draft survives as a safe private edit for explicit rebase.
	assert.ok(after.section.packages['pkg_without_quote']);
	assert.equal(after.section.rev, 2, 'purging is not an owner revision bump');
});

test('transcript deletion purges the section, quests and assignments in one commit', async () => {
	await seededFollowupRecord();
	const otherSource = { clientId: 'cli_other', sessionId: 'ses_other' };
	await commitShima(DEMO_KEY, (view) => ({
		section: {
			...view.section,
			rev: view.section.rev + 1,
			effort: { [ROOM_CHANGE_STEP_ID]: effortRow() },
			packages: { pkg_demo: packageRecord('pkg_demo', 'Some problem text.') },
		},
		upsertQuests: [
			questRecord('qst_demo', {
				clientId: HOTEL_DEMO_CLIENT_ID,
				sessionId: 'ses_hotel_demo',
			}),
			questRecord('qst_other', otherSource),
		],
		upsertAssignments: [
			assignmentRecord('asg_demo', 'qst_demo', 'a'.repeat(64)),
			assignmentRecord('asg_other', 'qst_other', 'b'.repeat(64)),
		],
		result: null,
	}));

	const current = await readSession(DEMO_KEY);
	assert.ok(current);
	const cleared = await casSession(DEMO_KEY, current.session.rev, {
		session: SessionSchema.parse({
			...current.session,
			transcript: null,
			workflow: { steps: [], edges: [] },
			questions: [],
			opportunities: [],
			proposals: [],
			discovery: null,
			reviewNotices: [],
		}),
		keys: { discovery: null, proposals: {} },
	});
	assert.ok(cleared);

	const after = await readShimaView(DEMO_KEY);
	assert.equal(after.session?.transcript, null);
	assert.equal(after.section.rev, 1, 'the section reads as fresh after a purge');
	assert.deepEqual(after.section.effort, {});
	assert.deepEqual(after.section.packages, {});
	assert.deepEqual(after.section.receipts, {});
	assert.equal(after.quests['qst_demo'], undefined);
	assert.equal(after.assignments['asg_demo'], undefined);
	// Another session's quest and assignment survive untouched.
	assert.ok(after.quests['qst_other']);
	assert.ok(after.assignments['asg_other']);
});

test('malformed Shima sections fail closed without resetting the store', async () => {
	useFreshDataDir();
	await getOrCreateHotelDemo(hotelSeed);
	const file = path.join(process.env.NUXT_DATA_DIR ?? '', 'p0-store.json');

	// A section revision must be a positive integer.
	const corrupted = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	corrupted.shima = {
		version: 1,
		sessions: { 'cli_hotel_demo/ses_hotel_demo': { rev: 0 } },
		quests: {},
		assignments: {},
	};
	writeFileSync(file, JSON.stringify(corrupted, null, '\t'));
	await assert.rejects(() => readShimaView(DEMO_KEY), StoreUnavailableError);
	await assert.rejects(
		() => casSession(DEMO_KEY, 1, { session: hotelSeed.session, keys: { discovery: null, proposals: {} } }),
		StoreUnavailableError,
	);

	// A non-object shima section is rejected wholesale, and the corrupt
	// primary is never replaced.
	const junk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	junk.shima = 'junk';
	writeFileSync(file, JSON.stringify(junk, null, '\t'));
	await assert.rejects(() => readSession(DEMO_KEY), StoreUnavailableError);
	const raw = readFileSync(file, 'utf8');
	assert.match(raw, /"shima": "junk"/);
	rmSync(process.env.NUXT_DATA_DIR ?? '', { recursive: true, force: true });
});

test('stores written before Shima read as empty and keep working', async () => {
	const directory = useFreshDataDir();
	const legacySession = SessionSchema.parse({
		id: 'ses_legacy',
		clientId: 'cli_legacy',
		title: 'Legacy interview',
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
	writeFileSync(
		path.join(directory, 'p0-store.json'),
		JSON.stringify(
			{
				version: 1,
				clients: { cli_legacy: { id: 'cli_legacy', name: 'Legacy Co' } },
				sessions: {
					'cli_legacy/ses_legacy': {
						session: legacySession,
						keys: { discovery: null, proposals: {} },
					},
				},
			},
			null,
			'\t',
		),
	);

	const legacyKey = { clientId: 'cli_legacy', sessionId: 'ses_legacy' };
	const view = await readShimaView(legacyKey);
	assert.equal(view.section.rev, 1);
	assert.equal(view.session?.id, 'ses_legacy');
	assert.deepEqual(view.quests, {});

	await commitShima(legacyKey, (current) => ({
		section: { ...current.section, rev: 2 },
		upsertQuests: [questRecord('qst_legacy', legacyKey)],
		result: null,
	}));
	const stored = JSON.parse(readFileSync(path.join(directory, 'p0-store.json'), 'utf8')) as {
		shima?: { sessions?: Record<string, unknown> };
	};
	assert.ok(stored.shima?.sessions?.['cli_legacy/ses_legacy']);
	// The legacy record survived the Shima write verbatim.
	assert.equal((await readSession(legacyKey))?.session.title, 'Legacy interview');
	assert.ok((await readShimaView(legacyKey)).quests['qst_legacy']);
});

test('quest and assignment records keep public content and private links apart', async () => {
	const quest = questRecord('qst_check', DEMO_KEY);
	const serialized = JSON.stringify(quest);
	assert.equal(serialized.includes(PUBLIC_TASK_SCHEMA_TAG), false);
	assert.match(quest.id, /^qst_/);
	assert.ok(quest.task.title.length > 0);
	assert.equal(Object.keys(quest.receipts).length, 0);
});
