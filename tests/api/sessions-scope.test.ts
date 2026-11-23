// API tests: client/session CRUD, per-client scoping, transcript deletion
// semantics (atomic reopen, idempotent no-op, stale revision), and storage
// guards on non-demo sessions. Runs against the built Nitro server.
import type { Client, Session } from '../../../shared/p0/types';
import { after, before, test } from 'node:test';
import {
	call,
	errorBody,
	startServer,
	stopServer,
} from './helpers/server';
import assert from 'node:assert/strict';

const base = { url: '' };
const asSession = (json: unknown): Session => json as Session;

before(async () => {
	base.url = await startServer();
});
after(async () => {
	await stopServer();
});

test('client creation validates input and lists clients', async () => {
	const created = await call('POST', `${base.url}/api/clients`, {
		name: 'Delete Scope Co',
	});
	assert.equal(created.status, 201);
	const client = created.json as Client;
	assert.match(client.id, /^cli_/);
	assert.equal(client.name, 'Delete Scope Co');

	const listed = await call('GET', `${base.url}/api/clients`);
	assert.equal(listed.status, 200);
	const clients = listed.json as Client[];
	assert.equal(clients.some((entry) => entry.id === client.id), true);

	const blank = await call('POST', `${base.url}/api/clients`, { name: '   ' });
	assert.equal(blank.status, 400);
	assert.equal(errorBody(blank.json).code, 'invalid_input');

	const tooLong = await call('POST', `${base.url}/api/clients`, {
		name: 'x'.repeat(201),
	});
	assert.equal(tooLong.status, 400);
	assert.equal(errorBody(tooLong.json).code, 'invalid_input');

	const unknownField = await call('POST', `${base.url}/api/clients`, {
		name: 'Extra',
		nickname: 'nope',
	});
	assert.equal(unknownField.status, 400);
});

test('sessions are created, listed, and scoped per client', async () => {
	const created = await call('POST', `${base.url}/api/clients`, {
		name: 'Session Scope Co',
	});
	const client = created.json as Client;

	const sessionResponse = await call(
		'POST',
		`${base.url}/api/clients/${client.id}/sessions`,
		{ title: 'Scope interview' },
	);
	assert.equal(sessionResponse.status, 201);
	const session = asSession(sessionResponse.json);
	assert.match(session.id, /^ses_/);
	assert.equal(session.clientId, client.id);
	assert.equal(session.rev, 1);
	assert.equal(session.transcript, null);
	assert.equal(session.origin, 'user');

	const listed = await call('GET', `${base.url}/api/clients/${client.id}/sessions`);
	assert.equal(listed.status, 200);
	const summaries = listed.json as { id: string; clientId: string; rev: number }[];
	assert.deepEqual(
		summaries.map((entry) => [entry.id, entry.clientId, entry.rev]),
		[[session.id, client.id, 1]],
	);

	const detail = await call(
		'GET',
		`${base.url}/api/clients/${client.id}/sessions/${session.id}`,
	);
	assert.equal(detail.status, 200);
	assert.equal(asSession(detail.json).title, 'Scope interview');

	// Cross-client reads stay scoped.
	const otherClient = (await call('POST', `${base.url}/api/clients`, {
		name: 'Other Scope Co',
	})).json as Client;
	const otherListed = await call(
		'GET',
		`${base.url}/api/clients/${otherClient.id}/sessions`,
	);
	assert.deepEqual(otherListed.json as unknown[], []);
	const crossRead = await call(
		'GET',
		`${base.url}/api/clients/${otherClient.id}/sessions/${session.id}`,
	);
	assert.equal(crossRead.status, 404);
	assert.equal(errorBody(crossRead.json).message, 'Unknown client or session.');

	const unknownClient = await call(
		'POST',
		`${base.url}/api/clients/cli_nope/sessions`,
		{ title: 'Orphan' },
	);
	assert.equal(unknownClient.status, 404);
	assert.equal(errorBody(unknownClient.json).message, 'Unknown client.');

	const badTitle = await call(
		'POST',
		`${base.url}/api/clients/${client.id}/sessions`,
		{ title: '' },
	);
	assert.equal(badTitle.status, 400);
	assert.equal(errorBody(badTitle.json).code, 'invalid_input');
});

test('fixture analysis refuses non-demo sessions with the fixed phrase', async () => {
	const client = (await call('POST', `${base.url}/api/clients`, {
		name: 'Fixture Scope Co',
	})).json as Client;
	const session = asSession(
		(
			await call('POST', `${base.url}/api/clients/${client.id}/sessions`, {
				title: 'User interview',
			})
		).json,
	);

	const seeded = await call('PUT', `${base.url}/api/clients/${client.id}/sessions/${session.id}/transcript`, {
		baseRev: 1,
		segments: [{ text: 'The clerk types every booking into the PMS.' }],
	});
	assert.equal(seeded.status, 200);

	const refused = await call(
		'POST',
		`${base.url}/api/clients/${client.id}/sessions/${session.id}/analyze`,
		{ baseRev: 2, mode: 'fixture' },
	);
	assert.equal(refused.status, 422);
	const refusedBody = errorBody(refused.json);
	assert.equal(refusedBody.code, 'fixture_unsupported');
	assert.equal(
		refusedBody.message,
		'Fixture provider only supports the seeded demo session.',
	);
});

test('transcript deletion reopens the session atomically and stays idempotent', async () => {
	const client = (await call('POST', `${base.url}/api/clients`, {
		name: 'Delete Flow Co',
	})).json as Client;
	const session = asSession(
		(
			await call('POST', `${base.url}/api/clients/${client.id}/sessions`, {
				title: 'Delete interview',
			})
		).json,
	);
	const sessionUrl = `${base.url}/api/clients/${client.id}/sessions/${session.id}`;

	const seeded = await call('PUT', `${sessionUrl}/transcript`, {
		baseRev: 1,
		segments: [
			{ text: 'First row of the interview.' },
			{ text: 'Second row of the interview.' },
		],
	});
	assert.equal(seeded.status, 200);
	const seededSession = asSession(seeded.json);
	assert.equal(seededSession.rev, 2);
	const segmentIds = seededSession.transcript?.segments.map((entry) => entry.id) ?? [];
	assert.equal(segmentIds.length, 2);

	const removed = await call(
		'DELETE',
		`${sessionUrl}/transcript?baseRev=2`,
	);
	assert.equal(removed.status, 200);
	const cleared = asSession(removed.json);
	assert.equal(cleared.rev, 3);
	assert.equal(cleared.transcript, null);
	assert.deepEqual(cleared.workflow, { steps: [], edges: [] });
	assert.deepEqual(cleared.questions, []);
	assert.deepEqual(cleared.opportunities, []);
	assert.deepEqual(cleared.proposals, []);
	assert.equal(cleared.discovery, null);

	// Deleted ids are never reusable.
	const reuse = await call('PUT', `${sessionUrl}/transcript`, {
		baseRev: 3,
		segments: [
			{
				id: segmentIds[0],
				speaker: null,
				text: 'Reusing a removed id',
				startMs: null,
				endMs: null,
			},
		],
	});
	assert.equal(reuse.status, 400);
	assert.equal(errorBody(reuse.json).code, 'invalid_input');

	// Deleting an already-cleared session is a no-op.
	const repeat = await call('DELETE', `${sessionUrl}/transcript?baseRev=3`);
	assert.equal(repeat.status, 200);
	assert.equal(asSession(repeat.json).rev, 3, 'no-op delete does not bump the revision');

	// A stale base revision is refused with the current revision.
	const stale = await call('DELETE', `${sessionUrl}/transcript?baseRev=1`);
	assert.equal(stale.status, 409);
	const staleBody = errorBody(stale.json);
	assert.equal(staleBody.code, 'stale_revision');
	assert.equal(staleBody.currentRev, 3);
});
