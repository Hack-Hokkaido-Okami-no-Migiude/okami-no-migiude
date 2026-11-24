import {
	type PilotDeploymentMode,
	type VerifiedPilotPrincipal,
	canAccessPilot,
} from './access';
import {
	type PilotReleaseSelection,
	PilotReleaseSelectionSchema,
	buildPilotPublicTask,
	isCohortTargetDate,
} from './public-template';
import { canonicalJson, publicTaskHash } from '#shared/shima/hash';
import { createHash, randomUUID } from 'node:crypto';
import { PublicTaskSchema } from '#shared/shima/schemas';
import { z } from 'zod';

type PackageBinding = Readonly<{ businessId: string; packageId: string }>;
export type PilotReleaseContext = Readonly<{
	deployment?:
		| Readonly<{
				mode: PilotDeploymentMode;
				realPilotEnabled?: boolean;
				/** Shared, non-package-specific deadline set by the deployment. */
				cohortTargetDate?: string;
		  }>
		| undefined;
	principal: VerifiedPilotPrincipal | null;
	/** Authoritative values read inside the repository mutation, not from the request. */
	current: PackageBinding
		& Readonly<{
			dataKind: 'fixture' | 'pilot';
			rev: number;
			/** Never reuse after a reshape or a change in any source the release depends on. */
			basis: string | null;
			/** Current package terms; the owner must confirm this exact amount. */
			proposedBudgetYen: number | null;
			/** Current explicit release permission, never reused after revocation; not a capture receipt. */
			permissionId: string | null;
			ownerId: string;
			reviewerId: string;
			adminId: string;
		}>;
}>;

type PilotReleasePreview = Readonly<{
	id: string;
	hash: string;
	basis: string;
	permissionId: string;
	ownerId: string;
	reviewerId: string;
	adminId: string;
	selection: PilotReleaseSelection;
	task: ReturnType<typeof buildPilotPublicTask>;
}>;
type Attestation = Readonly<{ actorId: string; cardBinding: string }>;
type ResultReference = Readonly<{
	previewId: string | null;
	questId: string | null;
}>;
type ReleaseReceipt = Readonly<{
	fingerprint: string;
	cardBinding: string | null;
	result: ResultReference;
}>;
export type PilotReleaseState = PackageBinding
	& Readonly<{
		preview: PilotReleasePreview | null;
		reviewerCheck: Attestation | null;
		ownerApproval: Attestation | null;
		permit: Attestation | null;
		questId: string | null;
		receipts: Readonly<Record<string, ReleaseReceipt>>;
	}>;

export type PilotPublicQuest = Readonly<{
	id: string;
	rev: 0;
	state: 'available';
	task: PilotReleasePreview['task'];
}>;
export type PilotBoardEffect =
	| Readonly<{ kind: 'put'; quest: PilotPublicQuest }>
	| Readonly<{ kind: 'remove'; id: string }>;
type ReleaseChange = Readonly<{
	state: PilotReleaseState;
	boardEffect: PilotBoardEffect | null;
}>;
type ReleaseFailureCode =
	| 'not_found'
	| 'invalid_input'
	| 'revision_conflict'
	| 'idempotency_conflict'
	| 'stale_preview'
	| 'consent_required'
	| 'release_not_permitted'
	| 'already_published';
export type PilotReleaseResult =
	| Readonly<{ ok: false; code: ReleaseFailureCode }>
	| (ReleaseChange
			& ResultReference
			& Readonly<{ ok: true; rev: number; replayed: boolean }>);

const baseRev = z.number().int().nonnegative();
const budget = PublicTaskSchema.shape.confirmedBudgetYen;
const exactCard = {
	baseRev,
	previewId: z.templateLiteral(['prv_', z.uuidv4()]),
	previewHash: z
		.string()
		.length(64)
		.regex(/^[0-9a-f]+$/u),
};
const confirmation = {
	confirmBudget: z.literal(true),
	confirmedBudgetYen: budget,
};
const releaseCommand = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('preview'),
		baseRev,
		selection: PilotReleaseSelectionSchema,
	}),
	z.strictObject({
		kind: z.literal('review'),
		...exactCard,
		approvePreview: z.literal(true),
	}),
	z.strictObject({
		kind: z.literal('approve'),
		...exactCard,
		approvePreview: z.literal(true),
		...confirmation,
	}),
	z.strictObject({
		kind: z.literal('permit'),
		...exactCard,
		granted: z.boolean(),
	}),
	z.strictObject({
		kind: z.literal('publish'),
		...exactCard,
		...confirmation,
	}),
	z.strictObject({ kind: z.literal('withdraw'), ...exactCard }),
]);
export type PilotReleaseCommand = z.infer<typeof releaseCommand>;

const capability = {
	owner: 'owner-release-route',
	reviewer: 'reviewer-release-route',
	admin: 'admin-release-route',
} as const;

function isReleaseRole(role: unknown): role is keyof typeof capability {
	return role === 'owner' || role === 'reviewer' || role === 'admin';
}

function commandRole(kind: unknown, actorRole: keyof typeof capability) {
	switch (kind) {
		case 'preview':
		case 'review':
			return 'reviewer';
		case 'approve':
			return 'owner';
		case 'permit':
		case 'publish':
			return 'admin';
		case 'withdraw':
			return actorRole === 'owner' || actorRole === 'admin' ?
					actorRole
				:	false;
		default:
			return null;
	}
}

function nonBlank(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function samePackage(left: PackageBinding, right: PackageBinding): boolean {
	return (
		nonBlank(left.businessId)
		&& nonBlank(left.packageId)
		&& left.businessId === right.businessId
		&& left.packageId === right.packageId
	);
}

function authoritiesAreDistinct({
	ownerId,
	reviewerId,
	adminId,
}: PilotReleaseContext['current']) {
	const actors = [ownerId, reviewerId, adminId];
	return actors.every(nonBlank) && new Set(actors).size === 3;
}

function validatedCard(
	preview: PilotReleasePreview,
	current: PilotReleaseContext['current'],
	cohortTargetDate: string,
) {
	const selection = PilotReleaseSelectionSchema.safeParse(preview.selection);
	if (
		!selection.success
		|| selection.data.confirmedBudgetYen !== current.proposedBudgetYen
		|| !PublicTaskSchema.safeParse(preview.task).success
		|| !exactCard.previewId.safeParse(preview.id).success
		|| !nonBlank(current.basis)
		|| !nonBlank(current.permissionId)
		|| preview.basis !== current.basis
		|| preview.permissionId !== current.permissionId
		|| preview.ownerId !== current.ownerId
		|| preview.reviewerId !== current.reviewerId
		|| preview.adminId !== current.adminId
	) {
		return null;
	}
	const task = buildPilotPublicTask(selection.data, cohortTargetDate);
	return (
			canonicalJson(task) === canonicalJson(preview.task)
				&& publicTaskHash(task) === preview.hash
		) ?
			task
		:	null;
}

function digest(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function bindCard(
	{ businessId, packageId }: PackageBinding,
	preview: PilotReleasePreview,
) {
	return digest([
		'pilot-release-card-v1',
		businessId,
		packageId,
		preview.id,
		preview.hash,
		preview.basis,
		preview.permissionId,
		preview.task.confirmedBudgetYen,
	]);
}

export function createPilotRelease(binding: PackageBinding): PilotReleaseState {
	return Object.freeze({
		businessId: binding.businessId,
		packageId: binding.packageId,
		preview: null,
		ownerApproval: null,
		reviewerCheck: null,
		permit: null,
		questId: null,
		receipts: Object.freeze({}),
	});
}

function matches(
	attestation: Attestation | null,
	actorId: string,
	cardBinding: string,
): boolean {
	return (
		attestation?.actorId === actorId
		&& attestation.cardBinding === cardBinding
	);
}

function approvedByBoth(
	state: PilotReleaseState,
	current: PilotReleaseContext['current'],
	card: string,
) {
	return (
		matches(state.ownerApproval, current.ownerId, card)
		&& matches(state.reviewerCheck, current.reviewerId, card)
	);
}

function permittedToPublish(
	state: PilotReleaseState,
	current: PilotReleaseContext['current'],
	card: string,
) {
	return (
		approvedByBoth(state, current, card)
		&& matches(state.permit, current.adminId, card)
	);
}

function clear(state: PilotReleaseState): ReleaseChange {
	return {
		state: Object.freeze({
			...createPilotRelease(state),
			receipts: state.receipts,
		}),
		boardEffect:
			state.questId ?
				Object.freeze({ kind: 'remove', id: state.questId })
			:	null,
	};
}

/** Commit its state and board removal alongside the source change; never defer to public reads. */
export function reconcilePilotRelease(
	state: PilotReleaseState,
	{
		current,
		deployment,
	}: Pick<PilotReleaseContext, 'current' | 'deployment'>,
	reason: 'revalidate' | 'reshape' | 'delete' = 'revalidate',
): ReleaseChange {
	const unchanged = { state, boardEffect: null };
	if (!samePackage(state, current) || (!state.preview && !state.questId)) {
		return unchanged;
	}
	const date = deployment?.cohortTargetDate;
	if (
		reason !== 'revalidate'
		|| current.dataKind !== 'pilot'
		|| deployment?.mode !== 'real-pilot'
		|| deployment.realPilotEnabled !== true
		|| !isCohortTargetDate(date)
		|| !authoritiesAreDistinct(current)
		|| !state.preview
		|| !validatedCard(state.preview, current, date)
		|| (state.questId
			&& !permittedToPublish(
				state,
				current,
				bindCard(state, state.preview),
			))
	) {
		return clear(state);
	}
	return unchanged;
}

function fail(code: ReleaseFailureCode): PilotReleaseResult {
	return { ok: false, code };
}

/**
 * Call with a fresh trusted view under the repo writer. The server fixes `input.kind` per route.
 * Commit revision, state and board effect together. On replay, do not write; use the returned
 * references to project retained state. Never send release state or receipts to the public board.
 */
export function transitionPilotRelease(
	state: PilotReleaseState,
	{ current, principal, deployment }: PilotReleaseContext,
	input: unknown,
	key: string,
): PilotReleaseResult {
	const cohortTargetDate = deployment?.cohortTargetDate;
	if (
		!samePackage(state, current)
		|| !deployment
		|| !isCohortTargetDate(cohortTargetDate)
		|| !authoritiesAreDistinct(current)
		|| !principal
		|| !isReleaseRole(principal.role)
		|| principal.actorId !== current[`${principal.role}Id`]
		|| !canAccessPilot({
			mode: deployment.mode,
			realPilotEnabled: deployment.realPilotEnabled,
			businessId: current.businessId,
			dataKind: current.dataKind,
			principal,
			capability: capability[principal.role],
		})
	) {
		return fail('not_found');
	}
	const kind = (input as { kind?: unknown } | null)?.kind;
	const role = commandRole(kind, principal.role);
	if (role !== null && role !== principal.role) {
		return fail('not_found');
	}
	const parsed = releaseCommand.safeParse(input);
	if (!parsed.success || !z.uuid().safeParse(key).success) {
		return fail('invalid_input');
	}
	const command = parsed.data;
	if (commandRole(command.kind, principal.role) !== principal.role) {
		return fail('not_found');
	}
	const receiptSlot = digest([
		'pilot-release-key-v1',
		state.businessId,
		state.packageId,
		principal.actorId,
		command.kind,
		key,
	]);
	const fingerprint = digest(['pilot-release-command-v1', command]);
	const existing = state.receipts[receiptSlot];
	const { preview } = state;
	const removes =
		command.kind === 'withdraw'
		|| (command.kind === 'permit' && !command.granted);
	if (existing) {
		if (existing.fingerprint !== fingerprint) {
			return fail('idempotency_conflict');
		}
		const { previewId, questId } = existing.result;
		if (
			!removes
			&& (!preview
				|| preview.id !== previewId
				|| !validatedCard(preview, current, cohortTargetDate)
				|| bindCard(state, preview) !== existing.cardBinding)
		) {
			return fail('not_found');
		}
		if (
			questId
			&& (questId !== state.questId
				|| !preview
				|| !permittedToPublish(
					state,
					current,
					bindCard(state, preview),
				))
		) {
			return fail('not_found');
		}
		return {
			ok: true,
			state,
			rev: current.rev,
			replayed: true,
			boardEffect: null,
			previewId,
			questId,
		};
	}
	if (
		command.baseRev !== current.rev
		|| current.rev >= Number.MAX_SAFE_INTEGER
	) {
		return fail('revision_conflict');
	}
	if (state.questId && !removes) {
		return fail('already_published');
	}
	if (!removes && !nonBlank(current.permissionId)) {
		return fail('consent_required');
	}
	let change: ReleaseChange;
	let questId: string | null = null;
	if (command.kind === 'preview') {
		if (
			!nonBlank(current.basis)
			|| !nonBlank(current.permissionId)
			|| command.selection.confirmedBudgetYen
				!== current.proposedBudgetYen
		) {
			return fail('stale_preview');
		}
		const task = buildPilotPublicTask(command.selection, cohortTargetDate);
		const preview = Object.freeze({
			id: `prv_${randomUUID()}`,
			hash: publicTaskHash(task),
			basis: current.basis,
			permissionId: current.permissionId,
			ownerId: current.ownerId,
			reviewerId: current.reviewerId,
			adminId: current.adminId,
			selection: Object.freeze(command.selection),
			task,
		});
		change = {
			state: { ...createPilotRelease(state), preview },
			boardEffect: null,
		};
	} else {
		if (
			!preview
			|| command.previewId !== preview.id
			|| command.previewHash !== preview.hash
		) {
			return fail('stale_preview');
		}
		if (removes) {
			change = clear(state);
		} else {
			const task = validatedCard(preview, current, cohortTargetDate);
			if (
				!task
				|| ('confirmedBudgetYen' in command
					&& command.confirmedBudgetYen !== task.confirmedBudgetYen)
			) {
				return fail('stale_preview');
			}
			const cardBinding = bindCard(state, preview);
			const attestation = Object.freeze({
				actorId: principal.actorId,
				cardBinding,
			});
			switch (command.kind) {
				case 'review':
					change = {
						state: { ...state, reviewerCheck: attestation },
						boardEffect: null,
					};
					break;
				case 'approve':
					change = {
						state: { ...state, ownerApproval: attestation },
						boardEffect: null,
					};
					break;
				case 'permit':
					if (!approvedByBoth(state, current, cardBinding)) {
						return fail('release_not_permitted');
					}
					change = {
						state: { ...state, permit: attestation },
						boardEffect: null,
					};
					break;
				case 'publish': {
					if (!permittedToPublish(state, current, cardBinding)) {
						return fail('release_not_permitted');
					}
					questId = `qst_${randomUUID()}`;
					const quest = Object.freeze({
						id: questId,
						rev: 0,
						state: 'available',
						task,
					} as const);
					change = {
						state: { ...state, questId },
						boardEffect: Object.freeze({ kind: 'put', quest }),
					};
					break;
				}
			}
		}
	}
	const retainedPreview = change.state.preview;
	const result = Object.freeze({
		previewId: retainedPreview?.id ?? null,
		questId,
	});
	const receipt = Object.freeze({
		fingerprint,
		result,
		cardBinding: retainedPreview && bindCard(state, retainedPreview),
	});
	const receipts = Object.freeze({
		...state.receipts,
		[receiptSlot]: receipt,
	});
	return {
		ok: true,
		rev: current.rev + 1,
		replayed: false,
		...result,
		boardEffect: change.boardEffect,
		state: Object.freeze({ ...change.state, receipts }),
	};
}
