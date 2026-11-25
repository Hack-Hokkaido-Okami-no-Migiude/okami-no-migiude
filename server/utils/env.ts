// Single home for environment access (contract §15) plus two QA knobs:
// - WORKER_POLL_MS: background worker idle poll interval (default 1000ms).
// - CLOCK_OFFSET_MS: signed offset added to the server wall clock, so QA can
//   prove deadline/expiry behavior by injecting the clock. Expiry can also be
//   proven by editing synthetic rows in ${DATA_DIR}/app.db directly.
// There is deliberately no HTTP backdoor for either.

export function dataDir(): string {
	return process.env.DATA_DIR || '.data';
}

export function publicBaseUrl(): string {
	return (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(
		/\/+$/,
		'',
	);
}

export function staffEmails(): string[] {
	return (process.env.STAFF_EMAILS || '')
		.split(',')
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}

export function staffPassword(): string {
	return process.env.STAFF_PASSWORD || '';
}

export function workerPollMs(): number {
	const parsed = Number.parseInt(process.env.WORKER_POLL_MS || '', 10);
	return Number.isFinite(parsed) && parsed >= 50 ? parsed : 1000;
}

export function clockOffsetMs(): number {
	const parsed = Number.parseInt(process.env.CLOCK_OFFSET_MS || '', 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function mailFrom(): string {
	return process.env.MAIL_FROM || 'okami-demo@localhost';
}
