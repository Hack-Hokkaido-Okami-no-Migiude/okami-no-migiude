// The publication gate for the Shima tracer: resolves whether the CURRENT
// persisted session may publish the one checked-in catalog task, throwing
// `fixture_unsupported` for every undocumented state. Everything is derived
// from persisted records and freshly recomputed run keys — never from canned
// values for dynamic answers.
import type { Id, Session } from '../../shared/p0/types';
import { type PublicQuestDetail, PublicQuestDetailSchema, type PublicTask } from '../../shared/shima/schemas';
import { SEED_FINGERPRINT, createHotelFixtureProvider, resolveBinding, transcriptFingerprint } from '../demo/hotel';
import { SHIMA_CATALOG_VERSIONS, shimaCatalogEntry } from '../demo/shima-quest';
import type { StoredPackage, StoredPreview, StoredQuest } from './storage';
import { canonicalJson, publicTaskHash } from '../../shared/shima/hash';
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

// Archived editions are readable on disk but not released on this board.
const activeCatalog = SHIMA_CATALOG_VERSIONS.reduce<(typeof SHIMA_CATALOG_VERSIONS)[number] | undefined>(
	(active, version) => !active || version.version > active.version ? version : active,
	undefined,
);

function unsupported(message: string): never {
	throw new StageError('fixture_unsupported', message);
}

/**
 * The identity gates shared by every Shima route: only the documented demo
 * session with an unmodified seed transcript may touch Shima state.
 */
export function assertFixtureSession(session: Session): void {
	const entry = activeCatalog?.tasks[0];
	if (!entry) {
		unsupported('The Shima catalog is empty.');
	}
	if (
		session.origin !== 'hotel-demo'
		|| session.clientId !== entry.binding.clientId
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
	const entry = activeCatalog?.tasks.find((candidate) => candidate.binding.opportunityId === opportunityId);
	if (!activeCatalog || !entry) {
		unsupported('The active catalog has no task for this opportunity.');
	}
	if (
		session.origin !== 'hotel-demo'
		|| session.clientId !== entry.binding.clientId
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
		unsupported('This opportunity is not present in the fixture.');
	}
	if (opportunity.hoursSavedPerMonth !== entry.task.estimatedHoursSavedPerMonth) {
		unsupported(
			'The estimated benefit no longer matches the fixture catalog.',
		);
	}
	return {
		catalogVersion: activeCatalog.version,
		catalogKey: entry.key,
		task: entry.task,
		answerId,
	};
}

export function isActiveFixturePreview(
	row: StoredPreview | undefined,
	pkg: StoredPackage['package'],
	eligibility: FixtureEligibility,
): row is StoredPreview {
	return !!row
		&& row.preview.id === pkg.previewId
		&& row.packageId === pkg.id
		&& row.basisKey === pkg.basisKey
		&& row.catalogVersion === eligibility.catalogVersion
		&& row.catalogKey === eligibility.catalogKey
		&& taskMatches(row.preview.task, row.preview.hash, eligibility.task);
}

/** Independently validate the board snapshot without reading a private session. */
export function activeQuestDetail(row: StoredQuest, recordId: string): PublicQuestDetail | null {
	const entry = row.catalogKey ? shimaCatalogEntry(row.catalogVersion, row.catalogKey) : null;
	if (!entry || row.id !== recordId
		|| row.source.clientId !== entry.binding.clientId || row.source.sessionId !== entry.binding.sessionId
		|| !taskMatches(row.task, row.taskHash, entry.task)) {
		return null;
	}
	if (row.state === 'available'
		? row.rev !== 1 || row.assigneeId != null || row.claimedAt != null
		: row.rev !== 2 || !row.assigneeId?.startsWith('asg_') || !row.claimedAt) {
		return null;
	}
	const detail = PublicQuestDetailSchema.safeParse({ id: row.id, rev: row.rev, state: row.state, task: row.task });
	return detail.success ? detail.data : null;
}

function taskMatches(task: PublicTask, hash: string | undefined, catalogTask: PublicTask): boolean {
	return hash === publicTaskHash(task) && canonicalJson(task) === canonicalJson(catalogTask);
}
