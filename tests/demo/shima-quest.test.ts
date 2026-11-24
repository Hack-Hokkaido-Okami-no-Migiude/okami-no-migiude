// Fixture QA for the Shima tracer catalog and publication gate (runs with tsx,
// no server build needed): one checked-in catalog task bound to the documented
// hotel follow-up and opp_hotel_02, eligibility resolved only from persisted
// seed identity + transcript fingerprint + fresh fixture discovery/proposal,
// and the canonical public-task hash that preview/publish rely on. Public task
// content must be a separate strict schema — never a stripped private draft.
import {
	HOTEL_DEMO_CLIENT_ID,
	HOTEL_DEMO_FOLLOWUP_ANSWER,
	HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	HOTEL_DEMO_SESSION_ID,
	HOTEL_FOLLOWUP_VARIANT,
	createHotelFixtureProvider,
	hotelSeed,
} from '../../server/demo/hotel';
import { PUBLIC_TASK_SCHEMA_TAG, publicTaskHash } from '../../shared/shima/hash';
import { PublicTaskSchema, TaskDraftSchema } from '../../shared/shima/schemas';
import {
	SHIMA_CATALOG_VERSIONS,
	SHIMA_EFFORT_MINUTES_PER_OCCURRENCE,
	SHIMA_EFFORT_WEEKLY_OCCURRENCES,
	matchesActiveShimaCatalogTask,
	shimaArchivedCatalogEntry,
	shimaCatalogEntry,
} from '../../server/demo/shima-quest';
import { discover, propose } from '../../server/analysis';
import type { Session } from '../../shared/p0/types';
import type { SessionRecord } from '../../server/store/repository';
import { StageError } from '../../shared/p0/stages';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveFixtureEligibility } from '../../server/shima/publication';
import test from 'node:test';

const OPPORTUNITY_ID = 'opp_hotel_02';
const ANY_ANSWER_ID = 'ans_fu_01';

/** A fresh deep copy of the seed session (the store clones on write too). */
function freshSeedSession(): Session {
	return structuredClone(hotelSeed.session);
}

/**
 * The full documented tracer state: base discovery, the documented follow-up
 * answer on q_hotel_01, follow-up discovery, and the generated opp_hotel_02
 * proposal — plus the artifact keys the real store would have committed.
 */
async function followupState(): Promise<{
	session: Session;
	keys: SessionRecord['keys'];
}> {
	const session = freshSeedSession();
	const baseProvider = createHotelFixtureProvider(session);
	const base = await discover(session, baseProvider);
	let current: Session = { ...session, ...base.patch };
	const question = current.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	assert.ok(question, 'base discovery must ask q_hotel_01');
	question.status = 'answered';
	question.answer = {
		id: ANY_ANSWER_ID,
		sourceRev: 1,
		text: HOTEL_DEMO_FOLLOWUP_ANSWER,
	};
	const followProvider = createHotelFixtureProvider(current);
	const follow = await discover(current, followProvider);
	current = { ...current, ...follow.patch };
	const keys: SessionRecord['keys'] = {
		discovery: follow.artifactKey,
		proposals: {},
	};
	const { proposal, artifactKey } = await propose(
		current,
		OPPORTUNITY_ID,
		followProvider,
	);
	current = { ...current, proposals: [...current.proposals, proposal] };
	keys.proposals = { [OPPORTUNITY_ID]: artifactKey };
	return { session: current, keys };
}

function assertFixtureUnsupported(action: () => unknown): void {
	assert.throws(
		action,
		(error: unknown) =>
			error instanceof StageError && error.code === 'fixture_unsupported',
	);
}

test('the active v2 catalog offers one task bound to the documented follow-up', () => {
	assert.equal(SHIMA_CATALOG_VERSIONS.length, 1);
	const version = SHIMA_CATALOG_VERSIONS[0];
	assert.ok(version);
	assert.equal(version.version, 2);
	assert.equal(version.tasks.length, 1);
	const entry = version.tasks[0];
	assert.ok(entry);
	assert.deepEqual(entry.binding, {
		clientId: HOTEL_DEMO_CLIENT_ID,
		sessionId: HOTEL_DEMO_SESSION_ID,
		opportunityId: OPPORTUNITY_ID,
		variant: HOTEL_FOLLOWUP_VARIANT,
	});
	assert.equal(entry.key, 'hotel-room-change-posting-v2');
	assert.equal(shimaCatalogEntry(2, entry.key), entry);
	assert.equal(shimaCatalogEntry(1, entry.key), null);
	assert.equal(shimaCatalogEntry(2, 'unknown-key'), null);

	// The public task is its own strict schema: a private draft shape does not
	// validate as public, and the public shape carries no private fields.
	const task = entry.task;
	const parsed = PublicTaskSchema.parse(task);
	assert.deepEqual(parsed, task);
	assert.equal(Number.isInteger(task.confirmedBudgetYen), true);
	assert.equal(task.confirmedBudgetYen, 80000);
	assert.equal(task.targetDate, '2026-12-18');
	assert.equal(
		PublicTaskSchema.safeParse({ ...task, extraKey: 'no' }).success,
		false,
	);
	assert.equal(
		PublicTaskSchema.safeParse({ ...task, proposedBudgetYen: 1 }).success,
		false,
	);
	const draftShape = {
		title: task.title,
		problem: task.problem,
		proposedChange: task.proposedChange,
		deliverables: task.deliverables,
		acceptanceCriteria: task.acceptanceCriteria,
		skills: task.skills,
		integrations: task.integrations,
		benefits: task.benefits,
		prerequisites: task.prerequisites,
		limitations: task.limitations,
		proposedBudgetYen: task.confirmedBudgetYen,
		targetDate: task.targetDate,
	};
	assert.equal(TaskDraftSchema.safeParse(draftShape).success, true);
});

test('the archived v1 card retains its original hash but is not public', () => {
	const v1Key = 'hotel-room-change-posting-v1';
	const archived = shimaArchivedCatalogEntry(1, v1Key);
	const active = shimaCatalogEntry(2, 'hotel-room-change-posting-v2');
	assert.ok(archived);
	assert.ok(active);
	assert.equal(
		publicTaskHash(archived.task),
		'69c54c2ae4cf45a7cc343b27179aba0b56c67bb93786e0b7cf6154a05626e6ff',
	);
	assert.equal(shimaCatalogEntry(1, v1Key), null);
	assert.equal(shimaArchivedCatalogEntry(2, active.key), null);
	assert.equal(matchesActiveShimaCatalogTask(1, archived.task), false);
	assert.equal(matchesActiveShimaCatalogTask(2, archived.task), false);
});

test('public catalog matching accepts only the active version and exact strict task', () => {
	const entry = shimaCatalogEntry(2, 'hotel-room-change-posting-v2');
	assert.ok(entry);
	const { task } = entry;
	assert.equal(matchesActiveShimaCatalogTask(2, structuredClone(task)), true);
	assert.equal(matchesActiveShimaCatalogTask(3, task), false);
	assert.equal(matchesActiveShimaCatalogTask(2, { ...task, extra: 'private' }), false);
	assert.equal(matchesActiveShimaCatalogTask(2, { ...task, benefits: ['changed'] }), false);
});

test('the active task is a generic lodging card without fixture identifiers or quotes', () => {
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	assert.ok(entry);
	assert.match(entry.task.title, /宿泊施設.*客室変更.*清掃予定/);
	const text = JSON.stringify(entry.task);
	assert.doesNotMatch(text, /佐渡|Sado|札幌|Sapporo|すすきの|Susukino|Yuki|\b(?:Sato|Kudo|Abe)\b|Excel|Google|\b7:30\b|[@「」]/i);
	assert.doesNotMatch(text, /(?:cli|ses|opp|step|q|seg)_hotel|hotel-demo/);
	assert.ok(!text.includes(HOTEL_DEMO_FOLLOWUP_ANSWER));
	for (const segment of hotelSeed.session.transcript?.segments ?? []) {
		assert.ok(!text.includes(segment.text));
	}
});

test('the active task caps the estimate at four peak-season weeks of manual handoff', () => {
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	assert.ok(entry);
	const { task } = entry;
	const fourWeekCeiling =
		(SHIMA_EFFORT_WEEKLY_OCCURRENCES * SHIMA_EFFORT_MINUTES_PER_OCCURRENCE * 4) / 60;
	assert.equal(fourWeekCeiling, 10);
	assert.equal(task.estimatedHoursSavedPerMonth, fourWeekCeiling);
	assert.match(task.benefits.join('\n'), /繁忙期.*すべて省けた場合.*月最大10時間.*試算.*週約10件.*1件約15分.*4週間/);
	assert.match(task.benefits.join('\n'), /実測ではない/);
	assert.match(task.limitations.join('\n'), /季節.*確認・例外対応/);
});

test('only confirmed room changes are appended; failed changes and cleaning stay manual', () => {
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	assert.ok(entry);
	const { task } = entry;
	assert.match(task.proposedChange, /確定した客室変更だけ.*追記/);
	assert.match(task.proposedChange, /反映できなかった変更.*担当者の確認/);
	assert.match(task.acceptanceCriteria.join('\n'), /未確定の変更は反映しない.*予定を書き換えず.*清掃済みにしない/);
	assert.match(task.limitations.join('\n'), /清掃の割り当てや実施は自動化しない/);
});

test('publication is eligible exactly for the persisted follow-up state', async () => {
	const { session, keys } = await followupState();
	const eligibility = resolveFixtureEligibility(session, keys, OPPORTUNITY_ID);
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	assert.ok(entry);
	assert.equal(eligibility.catalogKey, entry.key);
	assert.equal(eligibility.catalogVersion, 2);
	assert.deepEqual(eligibility.task, entry.task);
	assert.equal(eligibility.answerId, ANY_ANSWER_ID);
});

test('publication rejects every undocumented state', async () => {
	const { session, keys } = await followupState();

	// The unanalyzed seed has no discovery or proposal yet.
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(freshSeedSession(), {
			discovery: null,
			proposals: {},
		}, OPPORTUNITY_ID),
	);

	// The base variant (no saved answer) has no catalog entry.
	const baseSession = freshSeedSession();
	const base = await discover(baseSession, createHotelFixtureProvider(baseSession));
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(
			{ ...baseSession, ...base.patch },
			{ discovery: base.artifactKey, proposals: {} },
			OPPORTUNITY_ID,
		),
	);

	// A moved transcript row breaks the exact seed fingerprint.
	const editedTranscript = structuredClone(session);
	const segment = editedTranscript.transcript?.segments[0];
	assert.ok(segment && editedTranscript.transcript);
	editedTranscript.transcript.segments[0] = {
		...segment,
		text: `${segment.text} (edited)`,
	};
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(editedTranscript, keys, OPPORTUNITY_ID),
	);

	// A reworded saved answer is a different source, not the documented one.
	const editedAnswer = structuredClone(session);
	const answered = editedAnswer.questions.find(
		(entry) => entry.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	);
	assert.ok(answered?.answer);
	answered.answer = {
		...answered.answer,
		sourceRev: 2,
		text: `${answered.answer.text} (edited)`,
	};
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(editedAnswer, keys, OPPORTUNITY_ID),
	);

	// Stale discovery, missing proposal, and stale proposal are all refused.
	const staleDiscovery = structuredClone(session);
	if (staleDiscovery.discovery) {
		staleDiscovery.discovery = { ...staleDiscovery.discovery, stale: true };
	}
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(staleDiscovery, keys, OPPORTUNITY_ID),
	);
	const noProposal = structuredClone(session);
	noProposal.proposals = [];
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(noProposal, keys, OPPORTUNITY_ID),
	);
	const staleProposal = structuredClone(session);
	staleProposal.proposals = staleProposal.proposals.map((entry) => ({
		...entry,
		stale: true,
	}));
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(staleProposal, keys, OPPORTUNITY_ID),
	);

	// A foreign session id is never eligible, whatever its content.
	const foreign = structuredClone(session);
	foreign.id = 'ses_other';
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(foreign, keys, OPPORTUNITY_ID),
	);

	// The catalog binds opp_hotel_02 only; other opportunities are unsupported.
	assertFixtureUnsupported(() =>
		resolveFixtureEligibility(session, keys, 'opp_hotel_01'),
	);
});

test('the public task hash is canonical and independently reproducible', async () => {
	const { session, keys } = await followupState();
	const { task } = resolveFixtureEligibility(session, keys, OPPORTUNITY_ID);

	// Independent recomputation: keys recursively sorted lexicographically,
	// arrays in order, compact JSON, UTF-8 — hashed as SHA-256 hex.
	const independentCanonical = (value: unknown): string => {
		if (Array.isArray(value)) {
			return `[${value.map(independentCanonical).join(',')}]`;
		}
		if (value !== null && typeof value === 'object') {
			const entries = Object.entries(value as Record<string, unknown>).sort(
				([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
			);
			return `{${entries
				.map(
					([key, item]) => `${JSON.stringify(key)}:${independentCanonical(item)}`,
				)
				.join(',')}}`;
		}
		return JSON.stringify(value) ?? 'null';
	};
	const expected = createHash('sha256')
		.update(
			independentCanonical({ schema: PUBLIC_TASK_SCHEMA_TAG, task }),
			'utf8',
		)
		.digest('hex');
	assert.equal(publicTaskHash(task), expected);
	assert.match(publicTaskHash(task), /^[0-9a-f]{64}$/);

	// Key order never changes the hash; array order always does.
	const reordered = Object.fromEntries(Object.entries(task).reverse());
	assert.equal(publicTaskHash(reordered), expected);
	const reversedLists = {
		...task,
		deliverables: [...task.deliverables].reverse(),
	};
	assert.notEqual(publicTaskHash(reversedLists), expected);

	// Deterministic across calls, sensitive to content (Japanese title).
	assert.equal(publicTaskHash(task), publicTaskHash(task));
	assert.notEqual(
		publicTaskHash({ ...task, title: `${task.title} 改` }),
		expected,
	);
});
