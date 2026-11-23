// Consultant correction regression: a non-null correction submitted without
// verification persists as an inferred consultant claim carrying the unverified
// inference label — exactly the shape the shared schema requires, so the commit
// must succeed where a missing label used to fail persistence with 503.
// Covers string, list, and execution fields, cleared values, and preservation
// of unverified corrections through a fixture re-analysis.
import {
	HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
	createHotelFixtureProvider,
	hotelSeed,
} from '../../server/demo/hotel';
import type { Session, Step } from '../../shared/p0/types';
import { evidence, makeSession } from './helpers/fixture';
import {
	getOrCreateHotelDemo,
	readSession,
} from '../../server/store/repository';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { SessionSchema } from '../../shared/p0/schemas';
import { UNVERIFIED_CORRECTION_INFERENCE } from '../../server/store/claims';
import { applyStepCorrection } from '../../server/store/corrections';
import assert from 'node:assert/strict';
import { buildSourceIndex } from '../../server/store/sources';
import { commitSessionMutation } from '../../server/store/commit-session';
import { discover } from '../../server/analysis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runKey } from '../../server/analysis/keys';
import test from 'node:test';

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);

function useFreshDataDir(): string {
	const directory = mkdtempSync(path.join(repoRoot, '.data', 'corrections-'));
	process.env.NUXT_DATA_DIR = directory;
	return directory;
}

function stepOf(session: Session, id: string): Step {
	const step = session.workflow.steps.find((entry) => entry.id === id);
	if (!step) {
		throw new Error(`step '${id}' must exist`);
	}
	return step;
}

test('unverified string, list, and execution corrections persist and stale dependents', async () => {
	useFreshDataDir();
	await getOrCreateHotelDemo({
		client: { id: 'cli_t1', name: 'Test client' },
		session: makeSession(),
	});
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	const committed = await commitSessionMutation(
		key,
		1,
		(current) => {
			const sources = buildSourceIndex(current.session);
			const corrected = current.session.workflow.steps.map((entry) =>
				entry.id === 'step_1' ?
					applyStepCorrection(
						entry,
						{
							label: {
								value: 'Type booking (consultant rewording)',
								evidence: [
									evidence(
										'seg_src1',
										1,
										'types every booking into the PMS',
									),
								],
							},
							inputs: {
								value: ['Guest name', 'Dates'],
								evidence: [
									evidence(
										'seg_src1',
										1,
										'types every booking into the PMS',
									),
								],
							},
							execution: {
								value: 'manual',
								evidence: [
									evidence(
										'seg_src1',
										1,
										'types every booking into the PMS',
									),
								],
							},
						},
						false,
						sources,
					)
				:	entry,
			);
			return {
				session: {
					...current.session,
					workflow: { ...current.session.workflow, steps: corrected },
				},
			};
		},
		{ forceDiscoveryStale: true },
	);

	assert.equal(
		committed.rev,
		2,
		'a valid unverified correction must persist',
	);
	const corrected = stepOf(committed, 'step_1');
	assert.equal(corrected.label.state, 'inferred');
	assert.equal(corrected.label.author, 'consultant');
	assert.equal(corrected.label.value, 'Type booking (consultant rewording)');
	assert.equal(corrected.label.inference, UNVERIFIED_CORRECTION_INFERENCE);
	assert.deepEqual(corrected.inputs.value, ['Guest name', 'Dates']);
	assert.equal(corrected.inputs.inference, UNVERIFIED_CORRECTION_INFERENCE);
	assert.equal(corrected.execution.value, 'manual');
	assert.equal(
		corrected.execution.inference,
		UNVERIFIED_CORRECTION_INFERENCE,
	);
	// The persisted record must satisfy the shared session schema on reload.
	const reloaded = await readSession(key);
	assert.ok(reloaded);
	assert.equal(SessionSchema.safeParse(reloaded.session).success, true);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('cleared fields revert to unknown and carry no inference label', async () => {
	useFreshDataDir();
	await getOrCreateHotelDemo({
		client: { id: 'cli_t1', name: 'Test client' },
		session: makeSession(),
	});
	const key = { clientId: 'cli_t1', sessionId: 'ses_t1' };

	const committed = await commitSessionMutation(
		key,
		1,
		(current) => {
			const sources = buildSourceIndex(current.session);
			const corrected = current.session.workflow.steps.map((entry) =>
				entry.id === 'step_1' ?
					applyStepCorrection(
						entry,
						{ label: { value: null, evidence: [] } },
						false,
						sources,
					)
				:	entry,
			);
			return {
				session: {
					...current.session,
					workflow: { ...current.session.workflow, steps: corrected },
				},
			};
		},
		{ forceDiscoveryStale: true },
	);

	const cleared = stepOf(committed, 'step_1');
	assert.equal(cleared.label.value, null);
	assert.equal(cleared.label.state, 'unknown');
	assert.equal(cleared.label.author, 'consultant');
	assert.deepEqual(cleared.label.evidence, []);
	assert.equal(cleared.label.inference, undefined);
	assert.equal(
		cleared.graphEligible,
		false,
		'a step without a label is review-only',
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});

test('unverified corrections survive fixture re-analysis and change the discovery key', async () => {
	mkdirSync(path.join(repoRoot, '.data'), { recursive: true });
	useFreshDataDir();

	// Base discovery on an in-memory hotel session (the fixture provider is
	// stateless apart from the persisted-binding checks).
	const session: Session = structuredClone(hotelSeed.session);
	const basePatch = (
		await discover(session, createHotelFixtureProvider(session))
	).patch;
	const discovered: Session = { ...session, ...basePatch };
	const providerBefore = createHotelFixtureProvider(discovered);
	const keyBefore = runKey(discovered, 'discover', providerBefore);

	// Store the discovered session, correct one step without verification, and
	// run the discovery pipeline again over the corrected session.
	await getOrCreateHotelDemo({
		client: hotelSeed.client,
		session: discovered,
	});
	const key = {
		clientId: hotelSeed.client.id,
		sessionId: hotelSeed.session.id,
	};
	const correctedSession = await commitSessionMutation(
		key,
		1,
		(current) => {
			const sources = buildSourceIndex(current.session);
			const corrected = current.session.workflow.steps.map((entry) =>
				entry.id === 'step_hotel_02' ?
					applyStepCorrection(
						entry,
						{
							label: {
								value: 'Enter reservation into YukiReserve (consultant rewording)',
								evidence: [
									evidence(
										'seg_hotel_02',
										1,
										'types them into YukiReserve, our property management system',
									),
								],
							},
							inputs: {
								value: ['Guest name', 'Dates', 'Room type'],
								evidence: [
									evidence(
										'seg_hotel_02',
										1,
										'reads the details, like guest name, dates, room type',
									),
								],
							},
							execution: {
								value: 'manual',
								evidence: [
									evidence(
										'seg_hotel_02',
										1,
										'For every email, one of the clerks reads the details',
									),
								],
							},
						},
						false,
						sources,
					)
				:	entry,
			);
			return {
				session: {
					...current.session,
					workflow: { ...current.session.workflow, steps: corrected },
				},
			};
		},
		{ forceDiscoveryStale: true },
	);
	assert.equal(correctedSession.rev, 2);
	assert.equal(
		correctedSession.discovery?.stale,
		true,
		'a correction stales the existing discovery run',
	);

	const reanalyzed = await discover(
		correctedSession,
		createHotelFixtureProvider(correctedSession),
	);
	const rederived: Session = { ...correctedSession, ...reanalyzed.patch };
	const corrected = stepOf(rederived, 'step_hotel_02');
	assert.equal(
		corrected.label.value,
		'Enter reservation into YukiReserve (consultant rewording)',
		'the unverified consultant label survives re-analysis',
	);
	assert.equal(corrected.label.state, 'inferred');
	assert.equal(corrected.label.author, 'consultant');
	assert.deepEqual(corrected.inputs.value, [
		'Guest name',
		'Dates',
		'Room type',
	]);
	assert.deepEqual(corrected.execution.value, 'manual');
	// Analysis-authored claims re-derive; consultant ones are preserved.
	const neighbor = stepOf(rederived, 'step_hotel_01');
	assert.equal(neighbor.label.author, 'analysis');
	assert.equal(neighbor.label.state, 'inferred');

	// A changed consultant override must change the discovery key, so the next
	// analyze run reports `updated` rather than collapsing onto `unchanged`.
	assert.notEqual(
		runKey(rederived, 'discover', createHotelFixtureProvider(rederived)),
		keyBefore,
	);
	assert.equal(
		rederived.questions.find(
			(question) => question.id === HOTEL_DEMO_FOLLOWUP_QUESTION_ID,
		)?.status,
		'open',
	);

	rmSync(process.env.NUXT_DATA_DIR, { recursive: true, force: true });
});
