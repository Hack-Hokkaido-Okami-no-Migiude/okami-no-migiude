// P0 thin-slice API smoke: seed -> persisted graph/evidence -> proposal -> markdown -> restart.
// Runs against the built server (`npm run build` first) with a repo-local ignored data dir
// and a free local port, per the P0 contract acceptance section.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);
const serverEntry = path.join(repoRoot, '.output', 'server', 'index.mjs');

const CID = 'cli_hotel_demo';
const SID = 'ses_hotel_demo';
const S = `/api/clients/${CID}/sessions/${SID}`;

const PLAN_SECTIONS: { key: string; heading: string }[] = [
	{ key: 'scope', heading: 'Scope' },
	{ key: 'businessRules', heading: 'Business rules' },
	{ key: 'integrationsAuth', heading: 'Integrations & auth' },
	{ key: 'exceptions', heading: 'Exceptions' },
	{ key: 'humanOversight', heading: 'Human oversight' },
	{ key: 'milestones', heading: 'Milestones' },
	{ key: 'acceptanceTests', heading: 'Acceptance tests' },
];

const SEGMENT_IDS = [
	'seg_hotel_01',
	'seg_hotel_02',
	'seg_hotel_03',
	'seg_hotel_04',
	'seg_hotel_05',
	'seg_hotel_06',
	'seg_hotel_07',
	'seg_hotel_08',
	'seg_hotel_09',
];

function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const srv = net.createServer();
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const address = srv.address();
			if (address && typeof address === 'object') {
				const port = address.port;
				srv.close(() => {
					resolvePort(port);
				});
				return;
			}
			srv.close();
			reject(new Error('could not allocate a free port'));
		});
	});
}

type Server = {
	port: number;
	dataDir: string;
	child: ReturnType<typeof spawn>;
	stop: () => Promise<void>;
};

async function startServer(dataDir?: string): Promise<Server> {
	if (!existsSync(serverEntry)) {
		throw new Error(
			`server build missing at ${serverEntry} — run \`npm run build\` first`,
		);
	}
	const port = await freePort();
	mkdirSync(path.join(repoRoot, '.data'), { recursive: true });
	const dir = dataDir ?? mkdtempSync(path.join(repoRoot, '.data', 'smoke-'));
	const child = spawn(process.execPath, [serverEntry], {
		cwd: repoRoot,
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			NUXT_DATA_DIR: dir,
			NUXT_LLM_BASE_URL: '',
			NUXT_LLM_API_KEY: '',
			NUXT_LLM_MODEL: '',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stderr = '';
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const base = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			await fetch(`${base}/`);
			break;
		} catch {
			if (Date.now() > deadline) {
				child.kill();
				throw new Error(
					`server did not become ready on port ${port}\n${stderr}`,
				);
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	}
	return {
		port,
		dataDir: dir,
		child,
		stop: async () => {
			if (child.exitCode !== null || child.signalCode !== null) {
				return;
			}
			child.kill();
			await new Promise<void>((resolve) => {
				child.once('exit', () => {
					resolve();
				});
			});
		},
	};
}

async function call(
	port: number,
	method: string,
	urlPath: string,
	body?: unknown,
): Promise<{ status: number; headers: Headers; body: unknown; text: string }> {
	const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method,
		headers:
			body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		// non-JSON body (e.g. markdown download)
	}
	return {
		status: response.status,
		headers: response.headers,
		body: parsed,
		text,
	};
}

function errorBody(body: unknown): {
	code?: unknown;
	message?: unknown;
	currentRev?: unknown;
} {
	const record = body as { error?: Record<string, unknown> };
	return record?.error ?? {};
}

test('P0 fixture slice: seed -> discovery -> proposal -> markdown -> restart', async () => {
	assert.equal(
		existsSync(serverEntry),
		true,
		'server build must exist before smoke',
	);

	const server = await startServer();
	try {
		const { port } = server;

		// --- Seed: idempotent demo seed creates the fictional hotel session.
		const seeded = await call(port, 'POST', '/api/demo/hotel', {});
		assert.equal(seeded.status, 200, `seed failed: ${seeded.text}`);
		const seedSession = seeded.body as Record<string, unknown>;
		assert.equal(seedSession.id, SID);
		assert.equal(seedSession.clientId, CID);
		assert.equal(seedSession.origin, 'hotel-demo');
		assert.equal(seedSession.rev, 1);
		assert.match(
			String(seedSession.title),
			/fictional/i,
			'session must be explicitly labeled as a fictional fixture',
		);
		const transcript = seedSession.transcript as Record<string, unknown>;
		assert.equal(transcript.source, 'paste');
		const segments = transcript.segments as unknown[];
		assert.equal(segments.length, SEGMENT_IDS.length);
		assert.deepEqual(
			segments.map((s) => (s as Record<string, unknown>).id),
			SEGMENT_IDS,
		);
		for (const key of [
			'questions',
			'opportunities',
			'proposals',
			'reviewNotices',
		]) {
			assert.deepEqual(seedSession[key], [], `${key} starts empty`);
		}
		assert.deepEqual(
			(seedSession.workflow as Record<string, unknown>).steps,
			[],
		);
		assert.deepEqual(
			(seedSession.workflow as Record<string, unknown>).edges,
			[],
		);
		assert.equal(seedSession.discovery, null);

		// --- Seed is idempotent and never resets edits (checked again after analysis below).
		const reseeded = await call(port, 'POST', '/api/demo/hotel', {});
		assert.equal(reseeded.status, 200);
		assert.equal((reseeded.body as Record<string, unknown>).rev, 1);

		// --- GET session returns the same persisted session.
		const fetched = await call(port, 'GET', S);
		assert.equal(fetched.status, 200);
		assert.deepEqual(fetched.body, seedSession);

		// --- Unknown ids are 404 not_found with the shared error shape.
		const missing = await call(
			port,
			'GET',
			'/api/clients/cli_nope/sessions/ses_nope',
		);
		assert.equal(missing.status, 404);
		assert.equal(errorBody(missing.body).code, 'not_found');

		// --- Malformed request body -> 400 invalid_input.
		const malformed = await call(port, 'POST', `${S}/analyze`, {
			baseRev: 'one',
			mode: 'fixture',
		});
		assert.equal(malformed.status, 400);
		assert.equal(errorBody(malformed.body).code, 'invalid_input');

		// --- Analyze (fixture): discovery creates the persisted graph with evidence.
		const analyzed = await call(port, 'POST', `${S}/analyze`, {
			baseRev: 1,
			mode: 'fixture',
		});
		assert.equal(analyzed.status, 200, `analyze failed: ${analyzed.text}`);
		const analyzedBody = analyzed.body as {
			outcome?: unknown;
			session?: Record<string, unknown>;
		};
		assert.equal(analyzedBody.outcome, 'updated');
		const session1 = analyzedBody.session as Record<string, unknown>;
		assert.equal(session1.rev, 2);

		const discovery = session1.discovery as Record<string, unknown>;
		assert.equal(discovery.mode, 'fixture');
		assert.equal(discovery.stale, false);
		assert.equal(typeof discovery.completedAt, 'string');

		const workflow = session1.workflow as Record<string, unknown>;
		const steps = workflow.steps as Record<string, unknown>[];
		const stepIds = steps.map((s) => s.id as string).sort();
		assert.deepEqual(stepIds, [
			'step_hotel_01',
			'step_hotel_02',
			'step_hotel_03',
			'step_hotel_04',
			'step_hotel_05',
			'step_hotel_06',
			'step_hotel_07',
		]);
		for (const step of steps) {
			const label = step.label as Record<string, unknown>;
			assert.notEqual(
				label.value,
				null,
				`step ${String(step.id)} label must be known`,
			);
			assert.equal(label.state, 'inferred');
			assert.equal(label.author, 'analysis');
			assert.ok(
				(label.evidence as unknown[]).length >= 1,
				'label claim carries evidence',
			);
			assert.equal(step.graphEligible, true);
		}

		const edges = workflow.edges as Record<string, unknown>[];
		assert.deepEqual(edges.map((e) => e.id as string).sort(), [
			'edge_hotel_01',
			'edge_hotel_02',
			'edge_hotel_03',
			'edge_hotel_04',
			'edge_hotel_05',
			'edge_hotel_06',
		]);

		// No edge may exist between step_hotel_02 and step_hotel_06: the seed contains a
		// quote that mentions both endpoints without any transition phrase.
		const coocurrenceEdge = edges.find(
			(e) =>
				e.fromStepId === 'step_hotel_02'
				&& e.toStepId === 'step_hotel_06',
		);
		assert.equal(
			coocurrenceEdge,
			undefined,
			'co-occurrence must not create an edge',
		);

		const notices = session1.reviewNotices as Record<string, unknown>[];
		assert.ok(
			notices.some(
				(n) =>
					n.code === 'ambiguous_match'
					&& String(n.message).includes(
						'Enter reservation into YukiReserve',
					)
					&& String(n.message).includes(
						'Retype arrivals into cleaning schedule',
					),
			),
			`rejected co-occurrence must surface a review notice, got: ${JSON.stringify(notices)}`,
		);

		const questions = session1.questions as Record<string, unknown>[];
		assert.deepEqual(
			questions.map((q) => q.id),
			['q_hotel_01'],
		);
		assert.equal(questions[0]?.status, 'open');
		assert.equal(questions[0]?.answer, null);
		assert.equal(questions[0]?.factKey, 'frequency');
		assert.equal(questions[0]?.targetStepId, 'step_hotel_07');

		const opportunities = session1.opportunities as Record<
			string,
			unknown
		>[];
		assert.deepEqual(
			opportunities.map((o) => o.id),
			['opp_hotel_01'],
		);
		const opportunity = opportunities[0] as Record<string, unknown>;
		assert.equal(opportunity.strategy, 'integration');
		const assumptions = opportunity.assumptions as Record<
			string,
			Record<string, unknown>
		>;
		assert.equal(assumptions.monthlyOccurrences.value, 1200);
		assert.equal(assumptions.minutesSaved.value, 4);
		assert.equal(opportunity.hoursSavedPerMonth, 80);
		const factors = opportunity.factors as Record<
			string,
			Record<string, unknown>
		>;
		for (const factor of Object.values(factors)) {
			assert.ok(
				(factor.evidence as unknown[]).length >= 1,
				'opportunity factors must cite evidence',
			);
		}

		// --- All persisted evidence is verbatim: quote ⊆ source text at the cited rev.
		const segmentById = new Map<string, Record<string, unknown>>(
			(segments as Record<string, unknown>[]).map((s) => [
				String(s.id),
				s,
			]),
		);
		const verifyRefs = (refs: unknown, where: string) => {
			for (const ref of refs as Record<string, unknown>[]) {
				const segment = segmentById.get(String(ref.sourceId));
				assert.ok(
					segment,
					`${where}: unknown source ${String(ref.sourceId)}`,
				);
				assert.equal(
					segment?.sourceRev,
					ref.sourceRev,
					`${where}: stale source rev`,
				);
				const text = String(segment?.text);
				assert.ok(
					text.includes(String(ref.quote)),
					`${where}: quote is not a verbatim substring: ${String(ref.quote)}`,
				);
			}
		};
		for (const step of steps) {
			verifyRefs(
				(step.label as Record<string, unknown>).evidence,
				`step ${String(step.id)}`,
			);
		}
		for (const edge of edges) {
			verifyRefs(edge.evidence, `edge ${String(edge.id)}`);
		}
		verifyRefs(opportunity.evidence as unknown[], 'opportunity');

		// --- Re-analyzing identical content is a no-op (no write, no rev bump).
		const analyzedAgain = await call(port, 'POST', `${S}/analyze`, {
			baseRev: 2,
			mode: 'fixture',
		});
		assert.equal(analyzedAgain.status, 200);
		assert.equal(
			(analyzedAgain.body as { outcome?: unknown }).outcome,
			'unchanged',
		);
		assert.equal(
			(analyzedAgain.body as { session?: Record<string, unknown> })
				.session?.rev,
			2,
		);

		// --- Stale revision guard.
		const stale = await call(port, 'POST', `${S}/analyze`, {
			baseRev: 1,
			mode: 'fixture',
		});
		assert.equal(stale.status, 409);
		assert.equal(errorBody(stale.body).code, 'stale_revision');
		assert.equal(errorBody(stale.body).currentRev, 2);

		// --- Live mode requires explicit consent, then a configured provider.
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
		assert.equal(
			errorBody(unconfigured.body).code,
			'provider_unconfigured',
		);

		// --- Proposal for the discovered opportunity.
		const wrongOpp = await call(
			port,
			'POST',
			`${S}/opportunities/opp_nope/proposal`,
			{
				baseRev: 2,
				mode: 'fixture',
			},
		);
		assert.equal(wrongOpp.status, 404);
		assert.equal(errorBody(wrongOpp.body).code, 'not_found');

		const proposed = await call(
			port,
			'POST',
			`${S}/opportunities/opp_hotel_01/proposal`,
			{
				baseRev: 2,
				mode: 'fixture',
			},
		);
		assert.equal(proposed.status, 200, `proposal failed: ${proposed.text}`);
		const proposedBody = proposed.body as {
			outcome?: unknown;
			session?: Record<string, unknown>;
		};
		assert.equal(proposedBody.outcome, 'updated');
		const session2 = proposedBody.session as Record<string, unknown>;
		assert.equal(session2.rev, 3);

		const proposals = session2.proposals as Record<string, unknown>[];
		assert.equal(proposals.length, 1);
		const proposal = proposals[0] as Record<string, unknown>;
		assert.equal(proposal.opportunityId, 'opp_hotel_01');
		assert.equal(proposal.mode, 'fixture');
		assert.equal(proposal.stale, false);

		const plan = proposal.plan as Record<string, unknown>;
		assert.equal(plan.id, 'plan_hotel_01');
		assert.equal(plan.status, 'draft');
		const sections = plan.sections as Record<string, unknown>;
		for (const section of PLAN_SECTIONS) {
			assert.ok(
				String(sections[section.key] ?? '').length > 0,
				`plan section ${section.key} must be filled`,
			);
		}
		assert.deepEqual(plan.editedSections, []);

		const proposedGraph = proposal.graph as Record<string, unknown>;
		const proposedSteps = proposedGraph.steps as Record<string, unknown>[];
		assert.deepEqual(proposedSteps.map((s) => s.id).sort(), [
			'pstep_hotel_01',
			'pstep_hotel_02',
		]);
		for (const pstep of proposedSteps) {
			assert.ok((pstep.currentStepIds as unknown[]).length >= 1);
			for (const currentId of pstep.currentStepIds as string[]) {
				assert.ok(
					stepIds.includes(currentId),
					`proposed step maps unknown ${currentId}`,
				);
			}
			verifyRefs(pstep.evidence, `proposed step ${String(pstep.id)}`);
		}
		const proposedEdges = proposedGraph.edges as Record<string, unknown>[];
		assert.deepEqual(proposedEdges.map((e) => e.id).sort(), [
			'pedge_hotel_01',
		]);

		// --- Proposal is idempotent for identical basis.
		const proposedAgain = await call(
			port,
			'POST',
			`${S}/opportunities/opp_hotel_01/proposal`,
			{
				baseRev: 3,
				mode: 'fixture',
			},
		);
		assert.equal(proposedAgain.status, 200);
		assert.equal(
			(proposedAgain.body as { outcome?: unknown }).outcome,
			'unchanged',
		);
		assert.equal(
			(proposedAgain.body as { session?: Record<string, unknown> })
				.session?.rev,
			3,
		);

		// --- Seed does not reset committed artifacts.
		const reseededAfter = await call(port, 'POST', '/api/demo/hotel', {});
		assert.equal((reseededAfter.body as Record<string, unknown>).rev, 3);

		// --- Markdown download of the plan.
		const md = await call(
			port,
			'GET',
			`${S}/opportunities/opp_hotel_01/plan.md`,
		);
		assert.equal(md.status, 200, `plan.md failed: ${md.text}`);
		assert.ok(
			(md.headers.get('content-type') ?? '').includes('text/markdown')
				&& (md.headers.get('content-type') ?? '').includes(
					'charset=utf-8',
				),
			`unexpected content type: ${md.headers.get('content-type')}`,
		);
		assert.ok(
			(md.headers.get('content-disposition') ?? '').includes(
				'implementation-plan.md',
			),
			`unexpected disposition: ${md.headers.get('content-disposition')}`,
		);
		assert.ok(
			md.text.startsWith('# Implementation plan'),
			md.text.slice(0, 200),
		);
		for (const section of PLAN_SECTIONS) {
			assert.ok(
				md.text.includes(`## ${section.heading}`),
				`markdown must contain heading ${section.heading}`,
			);
		}
		assert.ok(md.text.includes('Status: draft'));
		assert.ok(
			md.text.includes('80'),
			'markdown must carry the labeled savings estimate',
		);

		// --- Restart on the same data dir: all committed ids and artifacts survive.
		await server.stop();
		const restarted = await startServer(server.dataDir);
		try {
			const afterRestart = await call(restarted.port, 'GET', S);
			assert.equal(afterRestart.status, 200);
			const revivedSession = afterRestart.body as Record<string, unknown>;
			assert.equal(revivedSession.rev, 3);
			assert.deepEqual(
				(
					(revivedSession.workflow as Record<string, unknown>)
						.steps as unknown[]
				).map((s) => (s as Record<string, unknown>).id),
				steps.map((s) => s.id),
			);
			assert.equal(
				(
					(
						revivedSession.proposals as Record<string, unknown>[]
					)[0] as Record<string, unknown>
				).opportunityId,
				'opp_hotel_01',
			);
			const mdAfterRestart = await call(
				restarted.port,
				'GET',
				`${S}/opportunities/opp_hotel_01/plan.md`,
			);
			assert.equal(mdAfterRestart.status, 200);
			assert.equal(mdAfterRestart.text, md.text);

			// --- Stale proposals are blocked from export (white-box: tamper persisted flag).
			const storePath = path.join(restarted.dataDir, 'p0-store.json');
			const store = JSON.parse(readFileSync(storePath, 'utf8')) as {
				sessions: Record<string, { session: Record<string, unknown> }>;
			};
			const record = store.sessions[`${CID}/${SID}`];
			assert.ok(
				record,
				'persisted session record must exist in the store file',
			);
			const tamperedProposal = (
				record.session.proposals as Record<string, unknown>[]
			)[0];
			tamperedProposal.stale = true;
			writeFileSync(storePath, JSON.stringify(store));
			const blocked = await call(
				restarted.port,
				'GET',
				`${S}/opportunities/opp_hotel_01/plan.md`,
			);
			assert.equal(blocked.status, 409);
			assert.equal(errorBody(blocked.body).code, 'stale_artifact');
		} finally {
			await restarted.stop();
		}
	} finally {
		if (server.child.exitCode === null) {
			await server.stop();
		}
		rmSync(server.dataDir, { recursive: true, force: true });
	}
});
