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
import { SHIMA_CATALOG_VERSIONS, shimaCatalogEntry } from '../../server/demo/shima-quest';
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

test('catalog version 1 offers exactly one task bound to the documented follow-up', () => {
	assert.equal(SHIMA_CATALOG_VERSIONS.length, 1);
	const version = SHIMA_CATALOG_VERSIONS[0];
	assert.ok(version);
	assert.equal(version.version, 1);
	assert.equal(version.tasks.length, 1);
	const entry = version.tasks[0];
	assert.ok(entry);
	assert.deepEqual(entry.binding, {
		clientId: HOTEL_DEMO_CLIENT_ID,
		sessionId: HOTEL_DEMO_SESSION_ID,
		opportunityId: OPPORTUNITY_ID,
		variant: HOTEL_FOLLOWUP_VARIANT,
	});
	assert.equal(shimaCatalogEntry(1, entry.key), entry);
	assert.equal(shimaCatalogEntry(2, entry.key), null);
	assert.equal(shimaCatalogEntry(1, 'unknown-key'), null);

	// The public task is its own strict schema: a private draft shape does not
	// validate as public, and the public shape carries no private fields.
	const task = entry.task;
	const parsed = PublicTaskSchema.parse(task);
	assert.deepEqual(parsed, task);
	assert.equal(Number.isInteger(task.confirmedBudgetYen), true);
	assert.ok(task.confirmedBudgetYen >= 0);
	assert.match(task.targetDate, /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(task.estimatedHoursSavedPerMonth, 10);
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

test('publication is eligible exactly for the persisted follow-up state', async () => {
	const { session, keys } = await followupState();
	const eligibility = resolveFixtureEligibility(session, keys, OPPORTUNITY_ID);
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	assert.ok(entry);
	assert.equal(eligibility.catalogKey, entry.key);
	assert.equal(eligibility.catalogVersion, 1);
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
