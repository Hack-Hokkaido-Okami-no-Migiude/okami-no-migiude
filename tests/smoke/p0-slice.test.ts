// Production-build fixture slice smoke: seed -> discovery -> proposal ->
// markdown -> restart durability, then the documented follow-up answer driving
// re-analysis and the discovery-stale export gate — all over the published HTTP
// API (no store-file tampering). Detailed wire-contract behavior is owned by
// tests/api/** and tests/demo/**; this file proves the built server slice.
import {
	type SmokeServer,
	call,
	currentRev,
	errorBody,
	removeDataDir,
	startSmokeServer,
} from './helpers/server';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const CID = 'cli_hotel_demo';
const SID = 'ses_hotel_demo';
const S = `/api/clients/${CID}/sessions/${SID}`;
const QUESTION_ID = 'q_hotel_01';

const PLAN_HEADINGS = [
	'Scope',
	'Business rules',
	'Integrations & auth',
	'Exceptions',
	'Human oversight',
	'Milestones',
	'Acceptance tests',
];

/** The documented follow-up answer (verbatim `HOTEL_DEMO_FOLLOWUP_ANSWER`). */
const FOLLOWUP_ANSWER =
	'Roughly two or three modification emails a day in high season, and maybe '
	+ 'one a day outside it; each one takes a couple of minutes to fix in '
	+ 'YukiReserve. The bigger headache is room changes. Whenever we change a '
	+ 'booking in YukiReserve — a modification email or a guest at the desk '
	+ 'asking to move rooms — if the room change happens after the 7:30 '
	+ 'arrivals list has gone over, we phone the housekeeping desk and Abe '
	+ 'rewrites the affected rows in the Excel schedule sheet by hand. I would '
	+ 'say we phone through about ten room changes a week in high season, and '
	+ 'each call plus the rewrite takes about a quarter of an hour. If we '
	+ 'forget to call, housekeeping sometimes cleans the wrong room first.';

const BASE_STEP_IDS = [
	'step_hotel_01',
	'step_hotel_02',
	'step_hotel_03',
	'step_hotel_04',
	'step_hotel_05',
	'step_hotel_06',
	'step_hotel_07',
];
const BASE_EDGE_IDS = [
	'edge_hotel_01',
	'edge_hotel_02',
	'edge_hotel_03',
	'edge_hotel_04',
	'edge_hotel_05',
	'edge_hotel_06',
];

const state: { server: SmokeServer | null } = { server: null };

async function stopServer(): Promise<SmokeServer['dataDir'] | null> {
	const server = state.server;
	state.server = null;
	if (server) {
		await server.stop();
	}
	return server?.dataDir ?? null;
}

before(async () => {
	state.server = await startSmokeServer();
});

after(async () => {
	const dataDir = await stopServer();
	if (dataDir) {
		removeDataDir(dataDir);
	}
});

test('seeds, discovers, proposes, and downloads the plan on the built server', async () => {
	const server = state.server;
	assert.ok(server, 'the smoke server must be running');
	const { port } = server;

	// --- Seed: idempotent, explicitly fictional, persisted at rev 1.
	const seeded = await call(port, 'POST', '/api/demo/hotel', {});
	assert.equal(seeded.status, 200, `seed failed: ${seeded.text}`);
	const seed = seeded.body as Record<string, unknown>;
	assert.equal(seed.id, SID);
	assert.equal(seed.clientId, CID);
	assert.equal(seed.origin, 'hotel-demo');
	assert.equal(seed.rev, 1);
	assert.match(String(seed.title), /fictional/i);
	assert.equal((seed.transcript as Record<string, unknown>).source, 'paste');
	assert.equal(seed.discovery, null);
	const reseeded = await call(port, 'POST', '/api/demo/hotel', {});
	assert.equal((reseeded.body as Record<string, unknown>).rev, 1);

	// --- Fixture discovery builds the evidence-backed base graph.
	const analyzed = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 1,
		mode: 'fixture',
	});
	assert.equal(analyzed.status, 200, `analyze failed: ${analyzed.text}`);
	assert.equal((analyzed.body as { outcome?: unknown }).outcome, 'updated');
	const analyzedSession = (
		analyzed.body as { session: Record<string, unknown> }
	).session;
	assert.equal(analyzedSession.rev, 2);
	const discovery = analyzedSession.discovery as Record<string, unknown>;
	assert.equal(discovery.mode, 'fixture');
	assert.equal(discovery.stale, false);
	assert.equal(typeof discovery.completedAt, 'string');
	const workflow = analyzedSession.workflow as Record<string, unknown>;
	assert.deepEqual(
		(workflow.steps as Record<string, unknown>[])
			.map((step) => step.id)
			.sort(),
		BASE_STEP_IDS,
	);
	assert.deepEqual(
		(workflow.edges as Record<string, unknown>[])
			.map((edge) => edge.id)
			.sort(),
		BASE_EDGE_IDS,
	);
	// The co-occurrence candidate must not become an edge; it surfaces as a
	// review notice instead (contract: no edge on endpoint co-occurrence alone).
	assert.equal(
		(workflow.edges as Record<string, unknown>[]).some(
			(edge) =>
				edge.fromStepId === 'step_hotel_02'
				&& edge.toStepId === 'step_hotel_06',
		),
		false,
	);
	assert.ok(
		(analyzedSession.reviewNotices as Record<string, unknown>[]).some(
			(notice) => notice.code === 'ambiguous_match',
		),
	);
	assert.deepEqual(
		(analyzedSession.questions as Record<string, unknown>[]).map(
			(question) => question.id,
		),
		[QUESTION_ID],
	);
	assert.deepEqual(
		(analyzedSession.opportunities as Record<string, unknown>[]).map(
			(opportunity) => opportunity.id,
		),
		['opp_hotel_01'],
	);
	assert.equal(
		(
			(
				analyzedSession.opportunities as Record<string, unknown>[]
			)[0] as Record<string, unknown>
		).hoursSavedPerMonth,
		80,
	);

	// --- Re-analyzing identical content is a no-op: unchanged, no rev bump.
	const rerun = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 2,
		mode: 'fixture',
	});
	assert.equal(rerun.status, 200);
	assert.equal((rerun.body as { outcome?: unknown }).outcome, 'unchanged');
	assert.equal(
		(rerun.body as { session?: Record<string, unknown> }).session?.rev,
		2,
	);

	// --- Stale revision guard with the current revision in the error body.
	const stale = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 1,
		mode: 'fixture',
	});
	assert.equal(stale.status, 409);
	assert.equal(errorBody(stale.body).code, 'stale_revision');
	assert.equal(errorBody(stale.body).currentRev, 2);

	// --- Live mode is gated: explicit consent first, then a configured provider.
	const noConsent = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 2,
		mode: 'live',
	});
	assert.equal(noConsent.status, 422);
	assert.equal(errorBody(noConsent.body).code, 'consent_required');
	const unconfigured = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 2,
		mode: 'live',
		allowExternal: true,
	});
	assert.equal(unconfigured.status, 503);
	assert.equal(errorBody(unconfigured.body).code, 'provider_unconfigured');
	assert.equal(await currentRev(port, S), 2, 'failed runs write nothing');

	// --- Proposal for the discovered opportunity, then the Markdown download.
	const wrongOpp = await call(
		port,
		'POST',
		`${S}/opportunities/opp_nope/proposal`,
		{ baseRev: 2, mode: 'fixture' },
	);
	assert.equal(wrongOpp.status, 404);
	assert.equal(errorBody(wrongOpp.body).code, 'not_found');

	const proposed = await call(
		port,
		'POST',
		`${S}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: 2, mode: 'fixture' },
	);
	assert.equal(proposed.status, 200, `proposal failed: ${proposed.text}`);
	assert.equal((proposed.body as { outcome?: unknown }).outcome, 'updated');
	const proposedSession = (
		proposed.body as { session: Record<string, unknown> }
	).session;
	assert.equal(proposedSession.rev, 3);
	const proposal = (
		proposedSession.proposals as Record<string, unknown>[]
	)[0] as Record<string, unknown>;
	assert.equal(proposal.opportunityId, 'opp_hotel_01');
	assert.equal(proposal.mode, 'fixture');
	assert.equal(proposal.stale, false);
	assert.equal(
		(proposal.plan as Record<string, unknown>).id,
		'plan_hotel_01',
	);
	assert.deepEqual(
		(
			(proposal.graph as Record<string, unknown>).steps as Record<
				string,
				unknown
			>[]
		)
			.map((step) => step.id)
			.sort(),
		['pstep_hotel_01', 'pstep_hotel_02'],
	);
	const markdown = await expectPlanMarkdown(port, 'opp_hotel_01', '80');
	assert.match(markdown, /Status: draft/);

	// --- Seeding again never resets committed artifacts.
	const reseededAfter = await call(port, 'POST', '/api/demo/hotel', {});
	assert.equal((reseededAfter.body as Record<string, unknown>).rev, 3);
});

test('restart keeps ids and plans; the stale discovery gate works over HTTP', async () => {
	const markdownBeforeRestart = await expectPlanMarkdown(
		state.server?.port ?? 0,
		'opp_hotel_01',
		'80',
	);
	const dataDirBefore = await stopServer();
	assert.ok(dataDirBefore, 'the first smoke server must have run');
	const restarted = await startSmokeServer({ dataDir: dataDirBefore });
	state.server = restarted;
	const { port } = restarted;
	assert.equal(await currentRev(port, S), 3);
	const revived = await call(port, 'GET', S);
	const revivedSession = revived.body as Record<string, unknown>;
	assert.deepEqual(
		(
			(revivedSession.workflow as Record<string, unknown>)
				.steps as Record<string, unknown>[]
		).map((step) => step.id),
		BASE_STEP_IDS,
	);
	assert.equal(
		await expectPlanMarkdown(port, 'opp_hotel_01', '80'),
		markdownBeforeRestart,
		'the persisted plan must export identically after a restart',
	);

	// --- The documented answer, recorded through its HTTP route, stales
	// discovery. Export is then blocked for every dependent proposal — even
	// before per-proposal staleness is recomputed.
	const answered = await call(
		port,
		'PUT',
		`${S}/questions/${QUESTION_ID}/answer`,
		{ baseRev: 3, text: FOLLOWUP_ANSWER },
	);
	assert.equal(answered.status, 200, `answer failed: ${answered.text}`);
	// The answer route returns the bare session record.
	const answeredSession = answered.body as Record<string, unknown>;
	assert.equal(answeredSession.rev, 4);
	const persistedAnswer = (
		(answeredSession.questions as Record<string, unknown>[]).find(
			(question) => question.id === QUESTION_ID,
		) as Record<string, unknown>
	).answer as Record<string, unknown>;
	assert.match(String(persistedAnswer.id), /^ans_/);
	assert.equal(persistedAnswer.text, FOLLOWUP_ANSWER);
	assert.equal(
		(answeredSession.discovery as Record<string, unknown>).stale,
		true,
	);

	const blockedByDiscovery = await call(
		port,
		'GET',
		`${S}/opportunities/opp_hotel_01/plan.md`,
	);
	assert.equal(blockedByDiscovery.status, 409);
	assert.equal(errorBody(blockedByDiscovery.body).code, 'stale_artifact');
	assert.match(
		String(errorBody(blockedByDiscovery.body).message),
		/Discovery is stale/,
	);

	// --- Re-analysis unlocks the documented follow-up variant.
	const reanalyzed = await call(port, 'POST', `${S}/analyze`, {
		baseRev: 4,
		mode: 'fixture',
	});
	assert.equal(
		reanalyzed.status,
		200,
		`re-analyze failed: ${reanalyzed.text}`,
	);
	assert.equal((reanalyzed.body as { outcome?: unknown }).outcome, 'updated');
	const followupSession = (
		reanalyzed.body as { session: Record<string, unknown> }
	).session;
	assert.equal(followupSession.rev, 5);
	assert.equal(
		(followupSession.discovery as Record<string, unknown>).stale,
		false,
	);
	const followupWorkflow = followupSession.workflow as Record<
		string,
		unknown
	>;
	assert.deepEqual(
		(followupWorkflow.steps as Record<string, unknown>[])
			.map((step) => step.id)
			.sort(),
		[...BASE_STEP_IDS, 'step_hotel_08'],
	);
	assert.deepEqual(
		(followupWorkflow.edges as Record<string, unknown>[])
			.map((edge) => edge.id)
			.sort(),
		[...BASE_EDGE_IDS, 'edge_hotel_07'],
	);
	// The answered question stays answered with its real persisted id, and the
	// answer-backed citations bind to it — never to a canned id.
	const keptQuestion = (
		followupSession.questions as Record<string, unknown>[]
	).find((question) => question.id === QUESTION_ID);
	assert.equal(keptQuestion?.status, 'answered');
	assert.deepEqual(keptQuestion?.answer, persistedAnswer);
	assert.deepEqual(
		(followupSession.opportunities as Record<string, unknown>[])
			.map((opportunity) => opportunity.id)
			.sort(),
		['opp_hotel_01', 'opp_hotel_02'],
	);
	// The base proposal's basis changed with the graph, so it stays stale; the
	// new opportunity has no proposal yet.
	const followupProposals = followupSession.proposals as Record<
		string,
		unknown
	>[];
	assert.equal(followupProposals.length, 1);
	assert.equal(followupProposals[0]?.stale, true);

	// Regeneration re-enables the base proposal and keeps its plan id.
	const regenerated = await call(
		port,
		'POST',
		`${S}/opportunities/opp_hotel_01/proposal`,
		{ baseRev: 5, mode: 'fixture' },
	);
	assert.equal(
		regenerated.status,
		200,
		`regeneration failed: ${regenerated.text}`,
	);
	const regeneratedSession = (
		regenerated.body as {
			session: Record<string, unknown>;
		}
	).session;
	assert.equal(regeneratedSession.rev, 6);
	const regeneratedProposal = (
		regeneratedSession.proposals as Record<string, unknown>[]
	).find((proposal) => proposal.opportunityId === 'opp_hotel_01');
	assert.equal(regeneratedProposal?.stale, false);
	assert.equal(
		(regeneratedProposal?.plan as Record<string, unknown>).id,
		'plan_hotel_01',
	);
	await expectPlanMarkdown(port, 'opp_hotel_01', '80');

	// --- The housekeeping proposal cites the persisted answer; its plan
	// exports with the labeled 10-hour basis and survives a restart verbatim.
	const housekeepingProposal = await call(
		port,
		'POST',
		`${S}/opportunities/opp_hotel_02/proposal`,
		{ baseRev: 6, mode: 'fixture' },
	);
	assert.equal(
		housekeepingProposal.status,
		200,
		`housekeeping proposal failed: ${housekeepingProposal.text}`,
	);
	const housekeepingSession = (
		housekeepingProposal.body as {
			session: Record<string, unknown>;
		}
	).session;
	assert.equal(housekeepingSession.rev, 7);
	const housekeeping = (
		housekeepingSession.proposals as Record<string, unknown>[]
	).find((candidate) => candidate.opportunityId === 'opp_hotel_02');
	assert.equal(
		(housekeeping?.plan as Record<string, unknown>).id,
		'plan_hotel_02',
	);
	const housekeepingMarkdown = await expectPlanMarkdown(
		port,
		'opp_hotel_02',
		'10 hours per month (basis: 40 occurrences × 15 minutes per occurrence',
	);

	const dataDirAfter = await stopServer();
	const finalServer = await startSmokeServer({
		dataDir: dataDirAfter ?? undefined,
	});
	state.server = finalServer;
	assert.equal(await currentRev(finalServer.port, S), 7);
	assert.equal(
		await expectPlanMarkdown(
			finalServer.port,
			'opp_hotel_02',
			'10 hours per month (basis: 40 occurrences × 15 minutes per occurrence',
		),
		housekeepingMarkdown,
		'the follow-up plan must export identically after a restart',
	);
});

/** Fetch a plan and assert the contract headers, sections, and savings basis. */
async function expectPlanMarkdown(
	port: number,
	opportunityId: string,
	savingsBasis: string,
): Promise<string> {
	const response = await call(
		port,
		'GET',
		`${S}/opportunities/${opportunityId}/plan.md`,
	);
	assert.equal(response.status, 200, `plan.md failed: ${response.text}`);
	const contentType = response.headers.get('content-type') ?? '';
	assert.match(contentType, /text\/markdown/);
	assert.match(contentType, /charset=utf-8/);
	assert.match(
		response.headers.get('content-disposition') ?? '',
		/implementation-plan\.md/,
	);
	assert.match(response.text, /^# Implementation plan/);
	for (const heading of PLAN_HEADINGS) {
		assert.match(response.text, new RegExp(`^## ${heading}$`, 'm'));
	}
	assert.ok(
		response.text.includes(savingsBasis),
		`plan markdown must carry the labeled savings: ${savingsBasis}`,
	);
	assert.ok(
		!response.text.includes('seg_hotel_'),
		'the plan export must never include raw transcript rows',
	);
	return response.text;
}
