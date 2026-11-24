import type { ShimaCommit, ShimaView } from '../store/repository';
import { StaleArtifactError, StaleSessionError, StoreLookupError } from '../store/errors';
import { activeQuestDetail, assertFixtureSession, isActiveFixturePreview, resolveFixtureEligibility } from './publication';
import { draftMatchesCatalog, packageProjection, packageStaleness } from './packages';
import { shimaMapView } from './map';

export function fixtureSession(view: ShimaView) {
	if (!view.session) {
		throw new StoreLookupError('Unknown client or session.');
	}
	assertFixtureSession(view.session);
	return view.session;
}

export function checkShimaRev(view: ShimaView, baseRev: number): void {
	if (view.section.rev !== baseRev) {
		throw new StaleSessionError('Session changed before the write; reload and retry.', view.section.rev);
	}
}

export function storedPackage(view: ShimaView, packageId: string) {
	const pkg = Object.hasOwn(view.section.packages, packageId) ? view.section.packages[packageId] : undefined;
	if (!pkg || pkg.package.id !== packageId) {
		throw new StoreLookupError('The package is not available.');
	}
	return pkg;
}

export function removePackagePreviews(view: ShimaView, packageId: string) {
	return Object.fromEntries(Object.entries(view.section.previews).filter(([, preview]) => preview.packageId !== packageId));
}

export function fixturePackageEligibility(view: ShimaView, pkg: ReturnType<typeof storedPackage>) {
	const session = fixtureSession(view);
	if (packageStaleness(session, view.keys, pkg)) {
		throw new StaleArtifactError('The package basis changed; refresh the draft first.');
	}
	return resolveFixtureEligibility(session, view.keys, pkg.package.opportunityId);
}

/** Both fresh responses and replays are projected from a single retained snapshot. */
export function projectShimaResult({ view, result }: ShimaCommit) {
	const session = fixtureSession(view);
	const rev = view.section.rev;
	if (result?.kind === 'package') {
		return { rev, package: packageProjection(session, view.keys, storedPackage(view, result.packageId)) };
	}
	if (result?.kind === 'effort' && Object.hasOwn(view.section.effort, result.stepId)) {
		return { rev, map: shimaMapView(session, view.section) };
	}
	if (result?.kind === 'preview') {
		const row = view.section.previews[result.previewId];
		const pkg = row && view.section.packages[row.packageId];
		if (pkg && pkg.package.ownerDecision !== 'decline' && pkg.package.previewId === result.previewId) {
			const eligibility = fixturePackageEligibility(view, pkg);
			if (isActiveFixturePreview(row, pkg.package, eligibility) && draftMatchesCatalog(pkg.package.draft, eligibility.task)) {
				return { rev, preview: row.preview };
			}
		}
		throw new StaleArtifactError('The preview is no longer active; prepare it again.');
	}
	if (result?.kind === 'publish') {
		const pkg = storedPackage(view, result.packageId);
		const row = view.quests[result.questId];
		const quest = row && activeQuestDetail(row, result.questId);
		if (quest && row.packageId === pkg.package.id && pkg.package.questId === quest.id) {
			return { rev, package: packageProjection(session, view.keys, pkg), quest };
		}
	}
	throw new StoreLookupError('The retained result is not available.');
}
