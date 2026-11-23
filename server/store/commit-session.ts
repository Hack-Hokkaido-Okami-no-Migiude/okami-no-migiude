// Shared commit flow for session-write routes: check the base revision, let the
// route build the next session content, run the source-change cascade and the
// staleness flags, skip the write when nothing changed, then commit through the
// store's compare-and-swap. Concurrency never retries silently — a lost race
// surfaces as `409 stale_revision` with the current revision.
import {
	type SessionKey,
	type SessionRecord,
	casSession,
	readSession,
} from './repository';
import { StaleSessionError, StoreLookupError } from './errors';
import { applyInvalidation, sameSession } from './invalidation';
import { stripInvalidCitations, withLostNotices } from './cascade';
import type { Session } from '../../shared/p0/types';

export type MutationOutcome = {
	/** The full next session content, or null when the write is a no-op. */
	session: Session | null;
	/** Replacement artifact keys, committed together with the session. */
	keys?: SessionRecord['keys'];
};

export type MutationOptions = {
	/**
	 * Run the citation cascade before committing (transcript and answer edits:
	 * stored citations that no longer validate are stripped, orphan edges are
	 * removed, and losses surface as review notices).
	 */
	cascadeCitations?: boolean;
	/** A step correction stales discovery even when no source row changed. */
	forceDiscoveryStale?: boolean;
};

export async function commitSessionMutation(
	key: SessionKey,
	baseRev: number,
	build: (current: SessionRecord) => MutationOutcome,
	options: MutationOptions = {},
): Promise<Session> {
	const current = await readSession(key);
	if (!current) {
		throw new StoreLookupError('Unknown client or session.');
	}
	if (current.session.rev !== baseRev) {
		throw new StaleSessionError(
			'Session changed before the write; reload and retry.',
			current.session.rev,
		);
	}

	const built = build(current);
	if (!built.session) {
		return current.session;
	}
	let next = built.session;
	if (options.cascadeCitations) {
		next = applyCitationCascade(next);
	}
	next = applyInvalidation(current.session, next, options.forceDiscoveryStale === true);
	if (sameSession(current.session, next)) {
		return current.session;
	}

	const committed = await casSession(key, baseRev, {
		session: next,
		keys: built.keys ?? current.keys,
	});
	if (!committed) {
		const raced = await readSession(key);
		throw new StaleSessionError(
			'Session changed during the write; reload and review before retrying.',
			raced?.session.rev ?? baseRev,
		);
	}
	return committed.session;
}

function applyCitationCascade(session: Session): Session {
	const cascade = stripInvalidCitations(session);
	return {
		...session,
		workflow: { steps: cascade.steps, edges: cascade.edges },
		opportunities: cascade.opportunities,
		// Surviving proposals arrive sanitized: purged graph citations and
		// plan sections scrubbed of moved source text.
		proposals: cascade.proposals,
		reviewNotices: withLostNotices(session.reviewNotices, cascade.lostNotices),
	};
}
