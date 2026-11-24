// Generate the owner's draft package from the CURRENT proposal: the tracer
// refuses anything but the documented follow-up opportunity, derives every
// draft field from the persisted opportunity and plan sections, and keeps the
// package private — no public fields until an exact preview is approved.
import {
	ShimaPackageCreateRequestSchema,
	createReceiptFingerprint,
	requireIdempotencyKey,
} from '~~/server/shima/requests';
import {
	draftFromProposal,
	findProposal,
	packageProjection,
} from '~~/server/shima/packages';
import {
	notFound,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { StageError } from '~~/shared/p0/stages';
import { StaleSessionError } from '~~/server/store/errors';
import { StoredPackageSchema } from '~~/server/shima/storage';
import { commitShima } from '~~/server/store/repository';
import { defineEventHandler } from 'h3';
import { newId } from '~~/server/store/ids';
import { resolveBinding } from '~~/server/demo/hotel';
import { resolveFixtureEligibility } from '~~/server/shima/publication';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const key = {
			clientId: requireParam(event, 'clientId'),
			sessionId: requireParam(event, 'sessionId'),
		};
		const body = await parseJsonBody(event, ShimaPackageCreateRequestSchema);
		const idempotencyKey = requireIdempotencyKey(event);
		const outcome = await commitShima(
			key,
			(current) => {
				// Every gate and derivation runs on the SAME committed snapshot the
				// CAS compares against; nothing is decided from a pre-read view.
				const session = current.session;
				if (!session) {
					throw notFound('Unknown client or session.');
				}
				// Duplicate generation is a no-op over retained state: it never
				// writes, so it needs no live baseRev and no fresh gates.
				const existing = Object.values(current.section.packages).find(
					(candidate) =>
						candidate.package.opportunityId === body.opportunityId,
				);
				if (existing) {
					return {
						section: current.section,
						changed: false,
						result: {
							rev: current.section.rev,
							package: packageProjection(session, current.keys, existing),
						},
					};
				}
				if (current.section.rev !== body.baseRev) {
					throw new StaleSessionError(
						'Session changed before the write; reload and retry.',
						current.section.rev,
					);
				}
				const eligibility = resolveFixtureEligibility(
					session,
					current.keys,
					body.opportunityId,
				);
				const opportunity = session.opportunities.find(
					(candidate) => candidate.id === body.opportunityId,
				);
				if (!opportunity) {
					throw notFound(
						`Unknown opportunity '${body.opportunityId}' for this session.`,
					);
				}
				const proposal = findProposal(session, body.opportunityId);
				if (!proposal) {
					throw notFound(`No proposal for opportunity '${body.opportunityId}'.`);
				}
				const basisKey = current.keys.proposals[body.opportunityId];
				if (!basisKey) {
					throw new StageError(
						'fixture_unsupported',
						'Generate the current proposal before publishing.',
					);
				}
				const answeredQuestion = session.questions.find(
					(candidate) => candidate.answer?.id === eligibility.answerId,
				);
				const answerRef = resolveBinding(session).answer;
				const answer = answeredQuestion?.answer;
				if (!answerRef || !answer) {
					throw new StageError(
						'fixture_unsupported',
						'The catalog task requires the documented follow-up proposal.',
					);
				}
				const pkgId = newId('pkg');
				const pkg = StoredPackageSchema.parse({
					editedFields: [],
					package: {
						id: pkgId,
						opportunityId: body.opportunityId,
						draft: draftFromProposal(opportunity, proposal.plan),
						basisKey,
						evidence: [
							{
								sourceId: answerRef.id,
								sourceRev: answerRef.sourceRev,
								quote: answer.text,
							},
						],
						state: 'draft',
						stale: false,
						decision: null,
						previewId: null,
						questId: null,
					},
				});
				const section = {
					...current.section,
					rev: current.section.rev + 1,
					packages: { ...current.section.packages, [pkgId]: pkg },
				};
				return {
					section,
					result: {
						rev: section.rev,
						package: packageProjection(session, current.keys, pkg),
					},
				};
			},
			{
				receipt: {
					route: 'shima-package-create',
					key: idempotencyKey,
					fingerprint: createReceiptFingerprint(body),
				},
			},
		);
		const response = outcome.committed
			? (outcome.result as Record<string, unknown>)
			: (outcome.replayedResponse as Record<string, unknown>);
		return response;
	}),
);
