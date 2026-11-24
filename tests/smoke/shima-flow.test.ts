// Smoke tracer flow over the built server: the full documented Hear → Map →
// Match path, single-winner claims under a genuine concurrent race, and the
// durability gates — claimed state and owner effort survive a process restart,
// receipts never resurrect purged work, and transcript deletion purges linked
// Shima state. Store-level behavior lives in tests/store; the API error matrix
// lives in tests/api. Uses a repo-local ignored data directory.
import { removeDataDir, startSmokeServer } from './helpers/server';
import test, { after } from 'node:test';
import { HOTEL_DEMO_FOLLOWUP_ANSWER } from '../../server/demo/hotel';
import assert from 'node:assert/strict';

const CID = 'cli_hotel_demo';
const SID = 'ses_hotel_demo';
const S = `/api/clients/${CID}/sessions/${SID}`;
const MAP = `${S}/shima/map`;
const EFFORT = `${S}/shima/effort/step_hotel_08`;
const PACKAGES = `${S}/shima/packages`;
const OPPORTUNITY_ID = 'opp_hotel_02';
const STEP_ID = 'step_hotel_08';
const CATALOG_YEN = 80000;
const CATALOG_DATE = '2026-12-18';
// The documented fixture wording, imported so the smoke flow can never drift
// from the checked-in variant the server gates on.
const FOLLOWUP_ANSWER = HOTEL_DEMO_FOLLOWUP_ANSWER;

const PUBLIC_TASK_FIELDS = [
	'title',
	'problem',
	'proposedChange',
	'deliverables',
	'acceptanceCriteria',
	'skills',
	'integrations',
	'benefits',
	'prerequisites',
	'limitations',
	'confirmedBudgetYen',
	'targetDate',
	'estimatedHoursSavedPerMonth',
] as const;

const BANNED_MARKERS = [
	'pkg_',
	'prv_',
	'asg_',
	'opp_hotel_',
	'step_hotel_',
	'edge_hotel_',
	'seg_hotel_',
	'ans_',
	'plan_hotel_',
	'pstep_hotel_',
	'pedge_hotel_',
	'cli_hotel_demo',
	'ses_hotel_demo',
	'actor_demo_owner',
	'owner-reported',
	'basisKey',
	'previewId',
];

type CallOptions = {
	key?: string;
	cookie?: string;
	origin?: string;
};

async function request(
	port: number,
	method: string,
	urlPath: string,
	body?: unknown,
	options: CallOptions = {},
): Promise<{
	status: number;
	body: unknown;
	text: string;
	setCookie: string[];
}> {
	const headers: Record<string, string> = {};
	if (body !== undefined) {
		headers['content-type'] = 'application/json';
	}
	if (options.key !== undefined) {
		headers['idempotency-key'] = options.key;
	}
	if (options.cookie !== undefined) {
		headers.cookie = options.cookie;
	}
	if (options.origin !== undefined) {
		headers.origin = options.origin;
	}
	const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		// Non-JSON body.
	}
	return {
		status: response.status,
		body: parsed,
		text,
		setCookie: response.headers.getSetCookie(),
	};
}

function errorOf(body: unknown): { code?: unknown; message?: unknown } {
	const record = body as { error?: Record<string, unknown> };
	return record?.error ?? {};
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`;
	}
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
		);
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(text),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function ownerReported(value: number, evidenceSourceId: string) {
	return {
		kind: 'owner-reported',
		value,
		basis: '繁忙期にオーナーが口頭で報告した概数。',
		evidence: [
			{
				sourceId: evidenceSourceId,
				sourceRev: 1,
				quote: FOLLOWUP_ANSWER,
			},
		],
	};
}

function assertNoPrivateMarkers(...bodies: unknown[]): void {
	const serialized = bodies.map((body) => JSON.stringify(body)).join('\n');
	for (const marker of BANNED_MARKERS) {
		assert.equal(
			serialized.includes(marker),
			false,
			`the public surface leaked the private marker '${marker}'`,
		);
	}
}

/**
 * The whole documented flow on a fresh store: seed → discover → answer →
 * re-analyze → effort → proposal → package → preview → publish. Returns the
 * published quest plus the publish receipt key for replay tests.
 */
async function publishCatalogQuest(
	port: number,
	options: { claim?: boolean } = {},
): Promise<{
	questId: string;
	packageId: string;
	task: Record<string, unknown>;
	publishKey: string;
	publishBody: {
		baseRev: number;
		previewId: string;
		previewHash: string;
		confirmedBudgetYen: number;
		confirmBudget: boolean;
		approvePreview: boolean;
	};
}> {
	const origin = `http://127.0.0.1:${port}`;
	const key = crypto.randomUUID();

	const seeded = await request(port, 'POST', '/api/demo/hotel', {});
	assert.equal(seeded.status, 200, seeded.text);
	const baseAnalyze = await request(port, 'POST', `${S}/analyze`, {
		baseRev: 1,
		mode: 'fixture',
	});
	assert.equal(baseAnalyze.status, 200, baseAnalyze.text);

	const answered = await request(port, 'PUT', `${S}/questions/q_hotel_01/answer`, {
		baseRev: 2,
		text: FOLLOWUP_ANSWER,
	});
	assert.equal(answered.status, 200, answered.text);
	const answeredBody = answered.body as {
		rev: number;
		questions: { id: string; answer: { id: string; sourceRev: number } | null }[];
	};
	const answer = answeredBody.questions
		.find((question) => question.id === 'q_hotel_01')
		?.answer;
	assert.ok(answer);

	const reanalyzed = await request(port, 'POST', `${S}/analyze`, {
		baseRev: answeredBody.rev,
		mode: 'fixture',
	});
	assert.equal(reanalyzed.status, 200, reanalyzed.text);
	const reanalyzedRev = (reanalyzed.body as { session: { rev: number } }).session.rev;

	const effort = await request(port, 'PUT', EFFORT, {
		baseRev: 1,
		effort: {
			weeklyOccurrences: ownerReported(10, answer.id),
			minutesPerOccurrence: ownerReported(15, answer.id),
		},
	}, { key });
	assert.equal(effort.status, 200, effort.text);
	const effortMap = (effort.body as {
		map: { manualEffort: { stepId: string; minutesSpentPerWeek: number | null }[] };
	}).map;
	assert.deepEqual(
		effortMap.manualEffort.map((row) => [row.stepId, row.minutesSpentPerWeek]),
		[[STEP_ID, 150]],
	);

	const proposed = await request(
		port,
		'POST',
		`${S}/opportunities/${OPPORTUNITY_ID}/proposal`,
		{ baseRev: reanalyzedRev, mode: 'fixture' },
	);
	assert.equal(proposed.status, 200, proposed.text);
	const map = await request(port, 'GET', MAP);
	const mapRev = (map.body as { rev: number }).rev;

	const created = await request(port, 'POST', PACKAGES, {
		baseRev: mapRev,
		opportunityId: OPPORTUNITY_ID,
	}, { key: crypto.randomUUID() });
	assert.equal(created.status, 200, created.text);
	const createdBody = created.body as {
		rev: number;
		package: { id: string; draft: Record<string, unknown> };
	};
	const pkg = createdBody.package;
	assert.equal(pkg.draft.title, 'Keep the housekeeping schedule current from confirmed room changes');

	const patched = await request(port, 'PATCH', `${PACKAGES}/${pkg.id}`, {
		baseRev: createdBody.rev,
		fields: { proposedBudgetYen: CATALOG_YEN, targetDate: CATALOG_DATE },
	}, { key: crypto.randomUUID() });
	assert.equal(patched.status, 200, patched.text);

	const previewed = await request(port, 'POST', `${PACKAGES}/${pkg.id}/preview`, {
		baseRev: (patched.body as { rev: number }).rev,
	}, { key: crypto.randomUUID() });
	assert.equal(previewed.status, 200, previewed.text);
	const preview = (previewed.body as {
		preview: { id: string; hash: string; task: Record<string, unknown> };
	}).preview;
	assert.equal(
		preview.hash,
		await sha256Hex(canonical({ schema: 'shima-public-task-v1', task: preview.task })),
	);
	assert.equal(preview.task.confirmedBudgetYen, CATALOG_YEN);
	assert.equal(preview.task.targetDate, CATALOG_DATE);
	assert.equal(preview.task.estimatedHoursSavedPerMonth, 10);
	assert.equal(Object.keys(preview.task).length, PUBLIC_TASK_FIELDS.length);

	// Private accept intent precedes publication, exactly as the owner flow
	// requires: publish is refused without the recorded accept decision.
	const accepted = await request(port, 'POST', `${PACKAGES}/${pkg.id}/decision`, {
		baseRev: (previewed.body as { rev: number }).rev,
		decision: 'accept',
	}, { key: crypto.randomUUID() });
	assert.equal(accepted.status, 200, accepted.text);
	const publishBody = {
		baseRev: (accepted.body as { rev: number }).rev,
		previewId: preview.id,
		previewHash: preview.hash,
		confirmedBudgetYen: CATALOG_YEN,
		confirmBudget: true,
		approvePreview: true,
	};
	const publishKey = crypto.randomUUID();
	const published = await request(port, 'POST', `${PACKAGES}/${pkg.id}/publish`, publishBody, { key: publishKey });
	assert.equal(published.status, 200, published.text);
	const publishedBody = published.body as {
		quest: { id: string; rev: number; state: string; task: Record<string, unknown> };
	};
	assert.equal(publishedBody.quest.state, 'available');
	assert.deepEqual(publishedBody.quest.task, preview.task);
	// The publish response also carries the owner's private package decision
	// (contract shape `{rev,package,quest}`); the no-private-marker rule here
	// guards the PUBLIC quest content, as on the board below.
	assertNoPrivateMarkers(publishedBody.quest);

	const board = await request(port, 'GET', '/api/quests');
	const summaries = board.body as { id: string }[];
	assert.deepEqual(summaries.map((summary) => summary.id), [publishedBody.quest.id]);
	assertNoPrivateMarkers(board.body);
	const engineerCookie = board.setCookie
		.find((cookie) => cookie.startsWith('shima_engineer='))
		?.split(';')[0];
	assert.ok(engineerCookie);

	// The race test needs the quest still available; the restart test needs it
	// claimed before the process dies.
	if (options.claim !== false) {
		const claimed = await request(port, 'POST', `/api/quests/${publishedBody.quest.id}/claim`, {
			baseRev: 1,
		}, { key: crypto.randomUUID(), cookie: engineerCookie, origin });
		assert.equal(claimed.status, 200, claimed.text);
		assert.equal((claimed.body as { state: string }).state, 'claimed');
	}

	return {
		questId: publishedBody.quest.id,
		packageId: pkg.id,
		task: preview.task,
		publishKey,
		publishBody,
	};
}

let smoke: Awaited<ReturnType<typeof startSmokeServer>> | null = null;
let dataDir: string | null = null;

after(async () => {
	if (smoke) {
		await smoke.stop();
	}
	if (dataDir) {
		removeDataDir(dataDir);
	}
});

test('the published quest, owner effort, and receipts survive a process restart', async () => {
	smoke = await startSmokeServer();
	dataDir = smoke.dataDir;
	const { questId, packageId, publishKey, publishBody } = await publishCatalogQuest(smoke.port);

	// --- Restart on the same data directory: the claim persists.
	await smoke.stop();
	const restarted = await startSmokeServer({ dataDir });
	smoke = restarted;

	const board = await request(restarted.port, 'GET', '/api/quests');
	const summaries = board.body as { id: string; state: string }[];
	assert.deepEqual(
		summaries.map((summary) => [summary.id, summary.state]),
		[[questId, 'claimed']],
	);

	const map = await request(restarted.port, 'GET', MAP);
	const mapView = map.body as {
		rev: number;
		manualEffort: { stepId: string; minutesSpentPerWeek: number | null }[];
	};
	assert.deepEqual(
		mapView.manualEffort.map((row) => [row.stepId, row.minutesSpentPerWeek]),
		[[STEP_ID, 150]],
	);

	// A replay of the publish receipt after restart: the fingerprint binds the
	// exact original body, so the replay resends it and gets the same result,
	// with no second quest.
	const replayedPublish = await request(
		restarted.port,
		'POST',
		`${PACKAGES}/${packageId}/publish`,
		publishBody,
		{ key: publishKey },
	);
	assert.equal(replayedPublish.status, 200, replayedPublish.text);
	assert.equal(
		(replayedPublish.body as { quest: { id: string } }).quest.id,
		questId,
	);
	const stillOne = await request(restarted.port, 'GET', '/api/quests');
	assert.equal((stillOne.body as unknown[]).length, 1);
	assert.deepEqual((stillOne.body as { id: string }[]).map((q) => q.id), [questId]);

	// --- Deletion purges linked Shima state; a restart keeps it purged.
	const session = await request(restarted.port, 'GET', S);
	const rev = (session.body as { rev: number }).rev;
	const deleted = await request(
		restarted.port,
		'DELETE',
		`${S}/transcript?baseRev=${rev}`,
	);
	assert.equal(deleted.status, 200, deleted.text);
	const emptyBoard = await request(restarted.port, 'GET', '/api/quests');
	assert.deepEqual(emptyBoard.body, []);
	const purgedMap = await request(restarted.port, 'GET', MAP);
	assert.deepEqual(
		(purgedMap.body as { manualEffort: unknown[] }).manualEffort,
		[],
	);

	await smoke.stop();
	const afterPurge = await startSmokeServer({ dataDir });
	smoke = afterPurge;
	const purgedBoard = await request(afterPurge.port, 'GET', '/api/quests');
	assert.deepEqual(purgedBoard.body, [], 'a purge must survive a restart');
	const purgedPackages = await request(afterPurge.port, 'GET', PACKAGES);
	assert.deepEqual(purgedPackages.body, { rev: 1, packages: [] });

	// After the purge the old receipt is gone: the replay must not resurrect
	// the package or the quest. The purged package lookup fails closed first,
	// so the fixed private not-found is the observable outcome.
	const replayAfterPurge = await request(
		afterPurge.port,
		'POST',
		`${PACKAGES}/${packageId}/publish`,
		publishBody,
		{ key: publishKey },
	);
	assert.equal(replayAfterPurge.status, 404);
	assert.equal(errorOf(replayAfterPurge.body).code, 'not_found');
	assert.deepEqual(
		(await request(afterPurge.port, 'GET', '/api/quests')).body,
		[],
	);
});

test('a concurrent claim race admits exactly one winner', async () => {
	const raceServer = await startSmokeServer();
	try {
		const origin = `http://127.0.0.1:${raceServer.port}`;
		const { questId } = await publishCatalogQuest(raceServer.port, {
			claim: false,
		});

		// Fresh engineer cookies for every racer.
		const cookies = await Promise.all(
			Array.from({ length: 6 }, async () => {
				const board = await request(raceServer.port, 'GET', '/api/quests');
				const cookie = board.setCookie
					.find((line) => line.startsWith('shima_engineer='))
					?.split(';')[0];
				assert.ok(cookie);
				return cookie;
			}),
		);

		const results = await Promise.all(
			cookies.map((cookie) =>
				request(raceServer.port, 'POST', `/api/quests/${questId}/claim`, { baseRev: 1 }, {
					key: crypto.randomUUID(),
					cookie,
					origin,
				}),
			),
		);
		const winners = results.filter((result) => result.status === 200);
		const losers = results.filter((result) => result.status === 409);
		assert.equal(winners.length, 1, `expected one winner, got ${winners.length}`);
		assert.equal(losers.length, 5);
		for (const loser of losers) {
			assert.equal(errorOf(loser.body).code, 'already_claimed');
		}
		const detail = await request(raceServer.port, 'GET', `/api/quests/${questId}`);
		assert.equal((detail.body as { state: string; rev: number }).state, 'claimed');
		assert.equal((detail.body as { rev: number }).rev, 2);
		assertNoPrivateMarkers(detail.body);
	} finally {
		await raceServer.stop();
		removeDataDir(raceServer.dataDir);
	}
});
