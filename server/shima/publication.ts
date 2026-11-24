// The publication gate for the Shima tracer: resolves whether the CURRENT
// persisted session may publish the one checked-in catalog task, throwing
// `fixture_unsupported` for every undocumented state. Everything is derived
// from persisted records and freshly recomputed run keys — never from canned
// values for dynamic answers.
import type { Id, Session } from '../../shared/p0/types';
import { SEED_FINGERPRINT, createHotelFixtureProvider, resolveBinding, transcriptFingerprint } from '../demo/hotel';
import {
	SHIMA_CATALOG_VERSIONS,
	type ShimaCatalogEntry,
} from '../demo/shima-quest';
import type { PublicTask } from '../../shared/shima/schemas';
import type { SessionRecord } from '../store/repository';
import { StageError } from '../../shared/p0/stages';
import { runKey } from '../analysis/keys';

export type FixtureEligibility = {
	catalogVersion: number;
	catalogKey: string;
	task: PublicTask;
	/** The persisted id of the documented follow-up answer. */
	answerId: Id;
};

function unsupported(message: string): never {
	throw new StageError('fixture_unsupported', message);
}

/**
 * The identity gates shared by every Shima route: only the documented demo
 * session with an unmodified seed transcript may touch Shima state.
 */
export function assertFixtureSession(session: Session): void {
	const entry = SHIMA_CATALOG_VERSIONS[0]?.tasks[0];
	if (!entry) {
		unsupported('The Shima catalog is empty.');
	}
	if (
		session.clientId !== entry.binding.clientId
		|| session.id !== entry.binding.sessionId
	) {
		unsupported('Shima is tracer-limited to the documented hotel fixture.');
	}
	if (
		session.transcript === null
		|| transcriptFingerprint(session.transcript) !== SEED_FINGERPRINT
	) {
		unsupported(
			'The transcript no longer matches the approved fixture variant.',
		);
	}
}

/**
 * Whether the session is currently eligible to publish the catalog task, and
 * why not. The follow-up variant is required: the task is bound to the
 * documented room-change proposal, which only exists once the follow-up
 * answer is recorded and analyzed.
 */
export function resolveFixtureEligibility(
	session: Session,
	keys: SessionRecord['keys'],
	opportunityId: Id,
): FixtureEligibility {
	const entry = findCatalogEntry(opportunityId);
	if (
		session.clientId !== entry.binding.clientId
		|| session.id !== entry.binding.sessionId
	) {
		unsupported('Shima is tracer-limited to the documented hotel fixture.');
	}
	if (
		session.transcript === null
		|| transcriptFingerprint(session.transcript) !== SEED_FINGERPRINT
	) {
		unsupported(
			'The transcript no longer matches the approved fixture variant.',
		);
	}
	const binding = resolveBinding(session);
	if (binding.variant !== entry.binding.variant) {
		unsupported(
			'The catalog task requires the documented follow-up proposal.',
		);
	}
	const answerId = binding.answer?.id;
	if (!answerId) {
		unsupported(
			'The catalog task requires the documented follow-up proposal.',
		);
	}
	if (session.discovery === null || session.discovery.stale) {
		unsupported('Run discovery before publishing to the Shima board.');
	}
	const provider = createHotelFixtureProvider(session);
	if (keys.discovery !== runKey(session, 'discover', provider)) {
		unsupported(
			'Discovery changed since the stored run; refresh discovery first.',
		);
	}
	const proposal = session.proposals.find(
		(candidate) => candidate.opportunityId === opportunityId,
	);
	if (!proposal || proposal.stale) {
		unsupported('Generate the current proposal before publishing.');
	}
	if (
		keys.proposals[opportunityId]
		!== runKey(session, 'propose', provider, opportunityId)
	) {
		unsupported('The proposal basis changed; generate it again first.');
	}
	const opportunity = session.opportunities.find(
		(candidate) => candidate.id === opportunityId,
	);
	if (!opportunity) {
		unsupported(`Unknown opportunity '${opportunityId}' for this session.`);
	}
	if (opportunity.hoursSavedPerMonth !== entry.task.estimatedHoursSavedPerMonth) {
		unsupported(
			`The catalog task states ${entry.task.estimatedHoursSavedPerMonth} hours per month, but the current proposal estimates ${opportunity.hoursSavedPerMonth}.`,
		);
	}
	return {
		catalogVersion: findCatalogVersion(opportunityId),
		catalogKey: entry.key,
		task: entry.task,
		answerId,
	};
}

function findCatalogEntry(opportunityId: Id): ShimaCatalogEntry {
	for (const catalog of SHIMA_CATALOG_VERSIONS) {
		const entry = catalog.tasks.find(
			(candidate) => candidate.binding.opportunityId === opportunityId,
		);
		if (entry) {
			return entry;
		}
	}
	unsupported(`The catalog has no task for opportunity '${opportunityId}'.`);
}

function findCatalogVersion(opportunityId: Id): number {
	for (const catalog of SHIMA_CATALOG_VERSIONS) {
		if (catalog.tasks.some((task) => task.binding.opportunityId === opportunityId)) {
			return catalog.version;
		}
	}
	unsupported(`The catalog has no task for opportunity '${opportunityId}'.`);
}
