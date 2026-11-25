// Consent gate state (contract §5: `consent` must be exactly `true` when
// starting; the browser refuses to send before every disclosure item is
// acknowledged). Pure module.

export type ConsentsState = {
	/** Content is processed automatically to draft a report. */
	processing: boolean;
	/** Capture stays in the browser; nothing is uploaded or stored. */
	privacy: boolean;
	/** Submitted transcript/report are visible to the intended staff. */
	staff: boolean;
};

export function emptyConsents(): ConsentsState {
	return { processing: false, privacy: false, staff: false };
}

export function allConsentsGiven(consents: ConsentsState): boolean {
	return consents.processing && consents.privacy && consents.staff;
}
