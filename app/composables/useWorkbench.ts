import {
	type AnalyzeResponse,
	ErrorBodySchema,
	type ErrorCode,
	type RunMode,
} from '#shared/p0/api';
import type {
	AssumptionsPatch,
	PlanPatch,
	StepPatch,
} from './workbenchDescriptors';
import type {
	Client,
	SegmentInput,
	Session,
	SessionSummary,
} from '#shared/p0/types';
import { buildRunRequest, removedReviewTargets } from './workbenchPolicy';

const STORAGE_KEY = 'p0.hotel-demo.session';
const clientUrl = (clientId: string) =>
	`/api/clients/${encodeURIComponent(clientId)}`;
const sessionUrl = (clientId: string, sessionId: string) =>
	`${clientUrl(clientId)}/sessions/${encodeURIComponent(sessionId)}`;
const opportunityUrl = (opportunityId: string) =>
	`/opportunities/${encodeURIComponent(opportunityId)}`;
const errorAdvice: Partial<Record<ErrorCode, string>> = {
	stale_revision:
		'Load the latest version, compare it with your draft, then apply your changes again. Nothing was retried.',
	stale_artifact:
		'Refresh discovery and regenerate the affected proposal before approving or exporting.',
	provider_failed:
		'The provider did not complete the request. Check its availability and retry with fresh consent. The last saved results are unchanged.',
	invalid_model_output:
		'The provider returned output that could not be validated. Review the source, then retry with fresh consent. The last saved results are unchanged.',
	provider_unconfigured:
		'No live provider is configured. Ask the local server operator to configure it before retrying.',
	fixture_unsupported:
		'Fixture analysis only works with the documented hotel interview and follow-up. No live request was made.',
	consent_required:
		'Live requests require approval each time. Read the disclosure before retrying.',
	storage_unavailable:
		'Local storage is unavailable. Keep this page open to preserve your unsaved edits.',
};

export function useWorkbench(hasUnsavedEdits: () => boolean) {
	const session = shallowRef<Session | null>(null);
	const clients = shallowRef<Client[]>([]);
	const sessions = shallowRef<SessionSummary[]>([]);
	const clientId = ref('');
	const busy = ref('');
	const problem = ref('');
	const notice = ref('');
	const conflict = ref(false);
	const writeDisabled = computed(() => Boolean(busy.value) || conflict.value);

	function showError(error: unknown) {
		const data =
			typeof error === 'object' && error !== null && 'data' in error ?
				error.data
			:	undefined;
		const parsed = ErrorBodySchema.safeParse(data);
		if (!parsed.success) {
			problem.value =
				'Could not complete the request. Check the local server connection and try again; unsaved input stays on this page.';
			return;
		}
		const { code, message, currentRev } = parsed.data.error;
		if (code === 'stale_revision' || code === 'stale_artifact') {
			conflict.value = true;
		}
		problem.value = [
			message,
			currentRev ? `Latest revision: ${currentRev}.` : '',
			errorAdvice[code],
		]
			.filter(Boolean)
			.join(' ');
	}

	async function perform(
		label: string,
		action: () => Promise<unknown>,
	): Promise<boolean> {
		if (busy.value) {
			return false;
		}
		busy.value = label;
		problem.value = '';
		notice.value = '';
		try {
			return (await action()) !== false;
		} catch (error) {
			showError(error);
			return false;
		} finally {
			busy.value = '';
		}
	}

	function useSession(next: Session) {
		const current = session.value;
		if (
			current?.id === next.id
			&& hasUnsavedEdits()
			&& removedReviewTargets(current, next)
			&& !window.confirm(
				'The saved version removed review items with possible unsaved edits. Load it and discard drafts for those items? Cancel to keep the current view and copy your edits.',
			)
		) {
			conflict.value = true;
			problem.value =
				'The saved version was not loaded. Copy any affected drafts, then load the latest revision.';
			return false;
		}
		session.value = next;
		conflict.value = false;
		if (clientId.value === next.clientId) {
			const { id, clientId: ownerId, title, rev, origin } = next;
			const summary = { id, clientId: ownerId, title, rev, origin };
			sessions.value =
				sessions.value.some((existing) => existing.id === id) ?
					sessions.value.map((existing) =>
						existing.id === id ? summary : existing,
					)
				:	[...sessions.value, summary];
		}
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ clientId: next.clientId, sessionId: next.id }),
			);
		} catch {
			/* Opening a session must also work with browser storage disabled. */
		}
		return true;
	}

	async function loadBrowse(ownerId: string) {
		const next =
			ownerId ?
				await $fetch<SessionSummary[]>(`${clientUrl(ownerId)}/sessions`)
			:	[];
		clientId.value = ownerId;
		sessions.value = next;
	}

	function browse(ownerId: string) {
		return perform('Loading interviews…', () => loadBrowse(ownerId));
	}

	function createClient(name: string) {
		return perform('Creating client…', async () => {
			const created = await $fetch<Client>('/api/clients', {
				method: 'POST',
				body: { name },
				retry: 0,
			});
			clients.value = [...clients.value, created];
			clientId.value = created.id;
			sessions.value = [];
			notice.value =
				'Client created. Create an interview to add a transcript.';
		});
	}

	function createSession(title: string) {
		if (!clientId.value) {
			return Promise.resolve(false);
		}
		return perform('Creating interview…', async () => {
			useSession(
				await $fetch<Session>(`${clientUrl(clientId.value)}/sessions`, {
					method: 'POST',
					body: { title },
					retry: 0,
				}),
			);
			notice.value = 'Interview created.';
		});
	}

	async function refreshClients() {
		clients.value = await $fetch<Client[]>('/api/clients');
	}

	function openDemo() {
		return perform('Opening hotel fixture…', async () => {
			const next = await $fetch<Session>('/api/demo/hotel', {
				method: 'POST',
				body: {},
				retry: 0,
			});
			if (!useSession(next)) {
				return false;
			}
			await Promise.all([refreshClients(), loadBrowse(next.clientId)]);
			notice.value = 'Fictional hotel interview opened.';
		});
	}

	function openSession(ownerId: string, id: string, reloading = false) {
		return perform(
			reloading ? 'Loading latest revision…' : 'Opening interview…',
			async () => {
				const next = await $fetch<Session>(sessionUrl(ownerId, id));
				if (!useSession(next)) {
					return false;
				}
				if (reloading) {
					notice.value = `Revision ${next.rev} loaded. Compare any preserved draft with the latest saved data before reapplying it.`;
				}
			},
		);
	}

	function storedSelection(): { clientId: string; sessionId: string } | null {
		try {
			const saved = JSON.parse(
				localStorage.getItem(STORAGE_KEY) ?? 'null',
			);
			if (
				typeof saved?.clientId === 'string'
				&& typeof saved.sessionId === 'string'
			) {
				return { clientId: saved.clientId, sessionId: saved.sessionId };
			}
		} catch {
			/* Client browsing does not depend on browser storage. */
		}
		return null;
	}

	function initialize() {
		return perform('Loading workbench…', async () => {
			const saved = storedSelection();
			await refreshClients();
			const ownerId = clients.value.find(
				({ id }) => id === saved?.clientId,
			)?.id;
			await loadBrowse(ownerId ?? clients.value[0]?.id ?? '');
			if (
				saved
				&& sessions.value.some(
					({ id }) =>
						id === saved.sessionId && ownerId === saved.clientId,
				)
			) {
				useSession(
					await $fetch<Session>(
						sessionUrl(saved.clientId, saved.sessionId),
					),
				);
			}
		});
	}

	function reload() {
		const current = session.value;
		return current ?
				openSession(current.clientId, current.id, true)
			:	initialize();
	}

	function edit(
		label: string,
		suffix: string,
		method: 'PUT' | 'DELETE' | 'PATCH',
		body: object = {},
	) {
		const current = session.value;
		if (!current || writeDisabled.value) {
			return Promise.resolve(false);
		}
		return perform(label, async () => {
			const baseRev = current.rev;
			const next = await $fetch<Session>(
				`${sessionUrl(current.clientId, current.id)}${suffix}`,
				{
					method,
					...(method === 'DELETE' ?
						{ query: { baseRev } }
					:	{ body: { ...body, baseRev } }),
					retry: 0,
				},
			);
			if (!useSession(next)) {
				return false;
			}
			notice.value =
				method === 'DELETE' ?
					'Transcript and dependent results deleted.'
				:	'Changes saved.';
		});
	}

	function run(mode: RunMode, allowed: boolean, opportunityId?: string) {
		const current = session.value;
		if (!current || writeDisabled.value) {
			return Promise.resolve(false);
		}
		const request = buildRunRequest(current.rev, mode, allowed);
		if (!request) {
			return Promise.resolve(false);
		}
		const subject = opportunityId ? 'Proposal' : 'Discovery';
		const suffix =
			opportunityId ?
				`${opportunityUrl(opportunityId)}/proposal`
			:	'/analyze';
		return perform(
			opportunityId ? 'Preparing proposal…' : 'Analyzing interview…',
			async () => {
				const result = await $fetch<AnalyzeResponse>(
					`${sessionUrl(current.clientId, current.id)}${suffix}`,
					{ method: 'POST', body: request, retry: 0 },
				);
				if (!useSession(result.session)) {
					return false;
				}
				notice.value =
					result.outcome === 'unchanged' ?
						`${subject} is already current. No new run was needed.`
					:	`${subject} updated.`;
			},
		);
	}

	function downloadPlan(opportunityId: string) {
		const current = session.value;
		if (!current || writeDisabled.value) {
			return Promise.resolve(false);
		}
		return perform('Downloading Markdown…', async () => {
			const blob = await $fetch<Blob>(
				`${sessionUrl(current.clientId, current.id)}${opportunityUrl(opportunityId)}/plan.md`,
				{
					responseType: 'blob',
					retry: 0,
					onResponseError: async ({ response }) => {
						// ofetch parses the entire response as a blob, including structured HTTP errors.
						if (response._data instanceof Blob) {
							response._data = await response._data
								.text()
								.then(JSON.parse)
								.catch(() => undefined);
						}
					},
				},
			);
			const href = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = href;
			link.download = 'implementation-plan.md';
			link.click();
			window.setTimeout(() => URL.revokeObjectURL(href), 1000);
			notice.value = 'Markdown downloaded.';
		});
	}

	return {
		session,
		clients,
		sessions,
		clientId,
		busy,
		problem,
		notice,
		conflict,
		writeDisabled,
		initialize,
		browse,
		createClient,
		createSession,
		openDemo,
		openSession,
		reload,
		run,
		downloadPlan,
		saveTranscript: (segments: SegmentInput[]) =>
			edit('Saving transcript…', '/transcript', 'PUT', { segments }),
		deleteTranscript: () =>
			edit('Deleting transcript…', '/transcript', 'DELETE'),
		saveFinding: (id: string, fields: StepPatch, verify: boolean) =>
			edit(
				'Saving finding…',
				`/steps/${encodeURIComponent(id)}`,
				'PATCH',
				{ fields, verify },
			),
		saveAnswer: (id: string, text: string) =>
			edit(
				'Saving answer…',
				`/questions/${encodeURIComponent(id)}/answer`,
				'PUT',
				{ text },
			),
		saveAssumptions: (id: string, assumptions: AssumptionsPatch) =>
			edit('Saving estimates…', opportunityUrl(id), 'PATCH', {
				assumptions,
			}),
		savePlan: (id: string, patch: PlanPatch) =>
			edit('Saving plan…', `${opportunityUrl(id)}/plan`, 'PATCH', patch),
	};
}
