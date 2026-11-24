import { ShimaCompleteRequestSchema, receiptFingerprint, requireIdempotencyKey } from '~~/server/shima/requests';
import { checkShimaRev, fixturePackageEligibility, projectShimaResult, storedPackage } from '~~/server/shima/owner';
import { commitShima, questAssignment } from '~~/server/store/repository';
import { parseJsonBody, requireParam, runRoute } from '~~/server/utils/http';
import { StaleArtifactError } from '~~/server/store/errors';
import { activeQuestDetail } from '~~/server/shima/publication';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) => runRoute(event, async () => {
	const key = { clientId: requireParam(event, 'clientId'), sessionId: requireParam(event, 'sessionId') };
	const packageId = requireParam(event, 'packageId');
	const body = await parseJsonBody(event, ShimaCompleteRequestSchema);
	const idempotencyKey = requireIdempotencyKey(event);
	return projectShimaResult(await commitShima(key, (view) => {
		const stored = storedPackage(view, packageId);
		checkShimaRev(view, body.baseRev);
		const pkg = stored.package;
		fixturePackageEligibility(view, stored);
		const quest = pkg.questId ? view.quests[pkg.questId] : undefined;
		const assignment = quest ? questAssignment(quest, view.assignments) : null;
		if (pkg.state !== 'published' || pkg.ownerDecision !== 'accept' || !quest || !assignment
			|| quest.packageId !== pkg.id || quest.source.clientId !== key.clientId || quest.source.sessionId !== key.sessionId
			|| !activeQuestDetail(quest, pkg.questId ?? '') || !quest.task.acceptanceCriteria.length
			|| quest.taskHash !== pkg.decision?.previewHash) {
			throw new StaleArtifactError('Only an assigned, published fixture task can be marked complete.');
		}
		const result = { kind: 'package', packageId } as const;
		if (pkg.completion?.assignmentId === assignment.id) {
			return { section: view.section, result };
		}
		// Calling complete is the owner's private attestation, not certification.
		return {
			section: {
				...view.section,
				rev: view.section.rev + 1,
				packages: {
					...view.section.packages,
					[packageId]: { ...stored, package: { ...pkg, completion: { assignmentId: assignment.id, at: new Date().toISOString() } } },
				},
			},
			result,
		};
	}, { receipt: { route: `shima-package-complete:${packageId}`, key: idempotencyKey, fingerprint: receiptFingerprint(body) } }));
}));
