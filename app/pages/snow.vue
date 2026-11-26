<script lang="ts" setup>
	// Snow-day flow (#21): JMA warning for the inn's area (or a demo
	// simulation) -> one draft per guest arriving today/tomorrow in the
	// guest's language -> the okami edits and approves -> send.
	import { snowStrings } from '~/locales/snow';

	type GuestLanguage = 'ja' | 'en' | 'zh-TW' | 'ko';
	type SnowKind = {
		code: string;
		nameJa: string;
		nameEn: string;
		level: 'advisory' | 'warning' | 'emergency';
	};
	type Message = {
		id: string;
		status: 'draft' | 'approved' | 'sent';
		language: GuestLanguage;
		body: string;
		trigger: 'jma' | 'simulated';
		warningNameJa: string;
		warningNameEn: string;
		approvedAt: string | null;
		sentAt: string | null;
		channel: 'local' | 'email' | null;
		deliveryChannel: 'local' | 'email';
		glossJa: string | null;
		glossEn: string | null;
	};
	type Guest = {
		id: string;
		guestName: string;
		guestCountry: string | null;
		language: GuestLanguage;
		contact: string | null;
		arrivalDate: string;
		nights: number;
		arrivesBy: string | null;
		isSample: boolean;
		message: Message | null;
	};
	type SnowPage = {
		today: string;
		tomorrow: string;
		municipality: string;
		area: {
			nameJa: string;
			nameEn: string;
			officeNameJa: string;
			officeNameEn: string;
		} | null;
		weather: {
			status: 'ok' | 'unavailable' | 'unknown_area';
			active: SnowKind[];
			reportDatetime: string | null;
		};
		guests: Guest[];
	};

	const { locale } = useAppLocale();
	const { user, refreshSession } = useOwnerSession();
	const t = computed(() => snowStrings[locale.value]);

	useHead({
		title: computed(() =>
			locale.value === 'ja' ?
				`${t.value.eyebrow} | 女将の右腕`
			:	`${t.value.eyebrow} | Okami no Migiude`,
		),
	});

	type Phase = 'checking' | 'signedOut' | 'forbidden' | 'ready' | 'error';
	const phase = ref<Phase>(
		!user.value ? 'signedOut'
		: user.value.role === 'owner' ? 'checking'
		: 'forbidden',
	);
	const page = ref<SnowPage | null>(null);
	const busy = ref(false);
	const notice = ref('');
	const actionError = ref(false);
	const deliveryFailed = ref(false);
	const edits = reactive<Record<string, string>>({});
	const glossOpen = reactive<Record<string, boolean>>({});
	const newGuest = reactive({
		guestName: '',
		language: 'en' as GuestLanguage,
		arrivalDate: '',
		nights: 1,
		guestCountry: '',
		contact: '',
	});

	function adopt(body: SnowPage): void {
		page.value = body;
		for (const guest of body.guests) {
			if (guest.message) {
				edits[guest.message.id] = guest.message.body;
			}
		}
		if (!newGuest.arrivalDate) {
			newGuest.arrivalDate = body.today;
		}
		phase.value = 'ready';
	}

	async function load(): Promise<void> {
		try {
			const response = await fetch('/api/snow');
			if (response.status === 401) {
				await refreshSession();
				phase.value = 'signedOut';
				return;
			}
			if (!response.ok) {
				phase.value = 'error';
				return;
			}
			adopt((await response.json()) as SnowPage);
		} catch {
			phase.value = 'error';
		}
	}

	async function post(
		path: string,
		body: Record<string, unknown>,
	): Promise<(SnowPage & { created?: number }) | null> {
		busy.value = true;
		actionError.value = false;
		deliveryFailed.value = false;
		notice.value = '';
		try {
			const response = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				const failure = (await response.json().catch(() => null)) as {
					data?: { error?: string };
				} | null;
				if (failure?.data?.error === 'delivery_failed') {
					deliveryFailed.value = true;
				} else {
					actionError.value = true;
				}
				return null;
			}
			const data = (await response.json()) as SnowPage & {
				created?: number;
			};
			adopt(data);
			return data;
		} catch {
			actionError.value = true;
			return null;
		} finally {
			busy.value = false;
		}
	}

	async function draft(mode: 'jma' | 'simulate'): Promise<void> {
		const data = await post('/api/snow/drafts', { mode });
		if (data) {
			notice.value =
				data.created ?
					t.value.draftsCreated(data.created)
				:	t.value.noneToDraft;
		}
	}

	function act(
		message: Message,
		action: 'save' | 'approve' | 'send' | 'discard',
	): void {
		const body: Record<string, unknown> = { action };
		if (
			message.status === 'draft'
			&& (action === 'save' || action === 'approve')
		) {
			body.body = edits[message.id] ?? message.body;
		}
		void post(`/api/snow/messages/${message.id}`, body);
	}

	function addGuest(): void {
		if (!newGuest.guestName.trim()) {
			return;
		}
		void post('/api/snow/guests', {
			guestName: newGuest.guestName,
			language: newGuest.language,
			arrivalDate: newGuest.arrivalDate,
			nights: Number(newGuest.nights),
			guestCountry: newGuest.guestCountry,
			contact: newGuest.contact,
		}).then((data) => {
			if (data) {
				newGuest.guestName = '';
				newGuest.guestCountry = '';
				newGuest.contact = '';
			}
		});
	}

	function kindName(kind: { nameJa: string; nameEn: string }): string {
		return locale.value === 'ja' ? kind.nameJa : kind.nameEn;
	}

	function gloss(message: Message): string | null {
		return locale.value === 'ja' ? message.glossJa : message.glossEn;
	}

	function formatWhen(iso: string): string {
		return new Date(iso).toLocaleString(
			locale.value === 'ja' ? 'ja-JP' : 'en-GB',
			{
				timeZone: 'Asia/Tokyo',
				dateStyle: 'medium',
				timeStyle: 'short',
			},
		);
	}

	function dayLabel(date: string): string {
		if (!page.value) {
			return date;
		}
		const day =
			date === page.value.today ? t.value.today
			: date === page.value.tomorrow ? t.value.tomorrow
			: '';
		return day ? `${day} (${date})` : date;
	}

	onMounted(() => {
		if (phase.value === 'checking') {
			void load();
		}
	});
</script>

<template>
	<div class="page-shell snow-page">
		<span class="eyebrow">{{ t.eyebrow }}</span>
		<h1 class="page-title">{{ t.title }}</h1>
		<p class="page-lead">{{ t.intro }}</p>

		<div
			v-if="phase === 'signedOut'"
			class="panel"
		>
			<p>{{ t.signedOut }}</p>
			<NuxtLink
				:to="{ path: '/sign-in', query: { next: '/snow' } }"
				class="button-primary"
			>
				{{ t.signInLink }}
			</NuxtLink>
		</div>
		<div
			v-else-if="phase === 'forbidden'"
			class="panel notice"
		>
			{{ t.forbidden }}
		</div>
		<div
			v-else-if="phase === 'checking'"
			class="panel"
		>
			{{ t.loading }}
		</div>
		<div
			v-else-if="phase === 'error' || !page"
			class="panel notice"
		>
			<p>{{ t.loadError }}</p>
			<button
				type="button"
				class="button-secondary"
				@click="load"
			>
				{{ t.retry }}
			</button>
		</div>
		<template v-else>
			<section
				class="panel snow-weather"
				:class="{ 'is-alert': page.weather.active.length > 0 }"
				aria-live="polite"
			>
				<h2 class="section-title">{{ t.weatherTitle }}</h2>
				<p
					v-if="page.area"
					class="snow-area"
				>
					{{ t.areaLabel }}:
					{{ locale === 'ja' ? page.area.nameJa : page.area.nameEn }}
					({{
						locale === 'ja' ?
							page.area.officeNameJa
						:	page.area.officeNameEn
					}})
				</p>
				<p
					v-if="page.weather.status === 'unknown_area'"
					class="notice notice--warn"
				>
					{{ t.areaUnknown(page.municipality) }}
				</p>
				<p
					v-else-if="page.weather.status === 'unavailable'"
					class="notice notice--warn"
				>
					{{ t.unavailable }}
				</p>
				<template v-else-if="page.weather.active.length > 0">
					<ul class="snow-kinds">
						<li
							v-for="kind in page.weather.active"
							:key="kind.code"
							:class="`level-${kind.level}`"
						>
							<span aria-hidden="true">❄</span>
							{{ kindName(kind) }} {{ t.snowActive }}
						</li>
					</ul>
					<button
						type="button"
						class="button-primary"
						:disabled="busy"
						@click="draft('jma')"
					>
						{{ t.draftFromJma }}
					</button>
				</template>
				<p v-else>{{ t.noSnow }}</p>
				<p
					v-if="page.weather.reportDatetime"
					class="snow-small"
				>
					{{ t.issuedAt }}:
					{{ formatWhen(page.weather.reportDatetime) }}
				</p>
				<p class="snow-small">{{ t.source }}</p>
				<div class="snow-demo">
					<button
						type="button"
						class="button-secondary"
						:disabled="busy"
						@click="draft('simulate')"
					>
						{{ t.simulate }}
					</button>
					<p class="snow-small">{{ t.simulateHint }}</p>
				</div>
			</section>

			<p
				v-if="notice"
				class="notice notice--info"
				role="status"
			>
				{{ notice }}
			</p>
			<p
				v-if="actionError"
				class="notice notice--warn"
				role="alert"
			>
				{{ t.actionError }}
			</p>
			<p
				v-if="deliveryFailed"
				class="notice notice--warn"
				role="alert"
			>
				{{ t.deliveryFailed }}
			</p>

			<section class="snow-guests">
				<h2 class="section-title">{{ t.guestsTitle }}</h2>
				<p class="snow-small">{{ t.guestsIntro }}</p>
				<div
					v-if="page.guests.length === 0"
					class="panel"
				>
					<p>{{ t.noGuests }}</p>
				</div>
				<article
					v-for="guest in page.guests"
					:key="guest.id"
					class="panel snow-guest"
				>
					<header class="snow-guest-head">
						<h3 class="snow-guest-name">{{ guest.guestName }}</h3>
						<span class="snow-badge">{{
							t.languages[guest.language]
						}}</span>
						<span
							v-if="guest.isSample"
							class="snow-badge snow-badge--muted"
							>{{ t.sampleBadge }}</span
						>
					</header>
					<p class="snow-small">
						{{ dayLabel(guest.arrivalDate) }} ·
						{{ t.nights(guest.nights) }}
						<template v-if="guest.guestCountry">
							· {{ guest.guestCountry }}</template
						>
						<template v-if="guest.arrivesBy">
							· {{ t.arrivesBy }}: {{ guest.arrivesBy }}</template
						>
						<template v-if="guest.contact">
							· {{ t.contact }}: {{ guest.contact }}</template
						>
					</p>

					<p
						v-if="!guest.message"
						class="snow-small"
					>
						{{ t.noMessage }}
					</p>
					<div
						v-else
						class="snow-message"
					>
						<div class="snow-message-head">
							<span
								class="snow-badge"
								:class="`status-${guest.message.status}`"
								>{{ t.status[guest.message.status] }}</span
							>
							<span class="snow-badge snow-badge--muted">
								{{
									guest.message.trigger === 'simulated' ?
										t.simulatedBadge
									:	t.jmaBadge
								}}:
								{{
									kindName({
										nameJa: guest.message.warningNameJa,
										nameEn: guest.message.warningNameEn,
									})
								}}
							</span>
						</div>
						<label
							class="snow-small"
							:for="`msg-${guest.message.id}`"
							>{{
								t.messageLabel(
									t.languages[guest.message.language],
								)
							}}</label
						>
						<textarea
							:id="`msg-${guest.message.id}`"
							v-model="edits[guest.message.id]"
							class="snow-textarea"
							:lang="guest.message.language"
							:readonly="guest.message.status !== 'draft'"
							rows="17"
						/>
						<template v-if="gloss(guest.message)">
							<button
								type="button"
								class="snow-gloss-toggle"
								@click="
									glossOpen[guest.message.id] =
										!glossOpen[guest.message.id]
								"
							>
								{{
									glossOpen[guest.message.id] ?
										t.hideGloss
									:	t.showGloss
								}}
							</button>
							<div
								v-if="glossOpen[guest.message.id]"
								class="snow-gloss"
							>
								<p class="snow-small">{{ t.glossNote }}</p>
								<pre>{{ gloss(guest.message) }}</pre>
							</div>
						</template>
						<div class="snow-actions">
							<template v-if="guest.message.status === 'draft'">
								<button
									type="button"
									class="button-secondary"
									:disabled="busy"
									@click="act(guest.message, 'save')"
								>
									{{ t.save }}
								</button>
								<button
									type="button"
									class="button-primary"
									:disabled="busy"
									@click="act(guest.message, 'approve')"
								>
									{{ t.approve }}
								</button>
							</template>
							<button
								v-if="guest.message.status === 'approved'"
								type="button"
								class="button-primary"
								:disabled="busy"
								@click="act(guest.message, 'send')"
							>
								{{ t.send }}
							</button>
							<button
								v-if="guest.message.status !== 'sent'"
								type="button"
								class="button-secondary"
								:disabled="busy"
								@click="act(guest.message, 'discard')"
							>
								{{ t.discard }}
							</button>
						</div>
						<p
							v-if="guest.message.status === 'draft'"
							class="snow-small"
						>
							{{ t.approvalNote }}
						</p>
						<p
							v-if="guest.message.status !== 'sent'"
							class="snow-small snow-destination"
						>
							{{
								guest.message.deliveryChannel === 'email' ?
									t.willEmail(guest.contact ?? '')
								:	t.willLocal
							}}
						</p>
						<p
							v-if="
								guest.message.status === 'sent'
								&& guest.message.sentAt
							"
							class="snow-small"
						>
							{{ t.status.sent }}:
							{{ formatWhen(guest.message.sentAt) }}.
							{{
								guest.message.channel === 'email' ?
									t.sentEmailNote(guest.contact ?? '')
								:	t.sentNote
							}}
						</p>
					</div>
				</article>

				<div class="panel snow-tools">
					<button
						type="button"
						class="button-secondary"
						:disabled="busy"
						@click="post('/api/snow/sample-guests', {})"
					>
						{{ t.loadSamples }}
					</button>
					<p class="snow-small">{{ t.loadSamplesHint }}</p>
					<form
						class="snow-add"
						@submit.prevent="addGuest"
					>
						<h3 class="h6">{{ t.addGuestTitle }}</h3>
						<label class="form-field">
							<span>{{ t.guestName }}</span>
							<input
								v-model="newGuest.guestName"
								type="text"
								maxlength="100"
								required
							/>
						</label>
						<label class="form-field">
							<span>{{ t.language }}</span>
							<select v-model="newGuest.language">
								<option
									v-for="(label, code) in t.languages"
									:key="code"
									:value="code"
								>
									{{ label }}
								</option>
							</select>
						</label>
						<label class="form-field">
							<span>{{ t.arrivalDate }}</span>
							<input
								v-model="newGuest.arrivalDate"
								type="date"
								required
							/>
						</label>
						<label class="form-field">
							<span>{{ t.nightsLabel }}</span>
							<input
								v-model.number="newGuest.nights"
								type="number"
								min="1"
								max="60"
							/>
						</label>
						<label class="form-field">
							<span>{{ t.country }}</span>
							<input
								v-model="newGuest.guestCountry"
								type="text"
								maxlength="60"
							/>
						</label>
						<label class="form-field">
							<span>{{ t.contactLabel }}</span>
							<input
								v-model="newGuest.contact"
								type="email"
								maxlength="200"
							/>
						</label>
						<button
							type="submit"
							class="button-secondary"
							:disabled="busy"
						>
							{{ t.add }}
						</button>
					</form>
				</div>
			</section>
		</template>
	</div>
</template>

<style scoped lang="scss">
	.snow-page {
		display: grid;
		gap: 1rem;
	}
	.snow-weather.is-alert {
		border: 2px solid var(--rust);
	}
	.snow-kinds {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: grid;
		gap: 0.4rem;
		li {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			font-weight: 700;
			font-size: 1.15rem;
			color: var(--rust-deep);
		}
	}
	.snow-small {
		font-size: 0.95rem;
		color: var(--ink-soft);
		margin: 0.25rem 0;
	}
	.snow-demo {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--line-strong);
	}
	.snow-guests {
		display: grid;
		gap: 0.75rem;
	}
	.snow-guest-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.snow-guest-name {
		margin: 0;
		font-size: 1.25rem;
	}
	.snow-badge {
		display: inline-block;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--evergreen);
		color: var(--snow);
		font-size: 0.85rem;
	}
	.snow-badge--muted {
		background: var(--parchment);
		color: var(--ink);
		border: 1px solid var(--line-strong);
	}
	.status-draft {
		background: var(--rust);
	}
	.status-approved {
		background: var(--evergreen);
	}
	.status-sent {
		background: var(--evergreen-deep);
	}
	.snow-message {
		margin-top: 0.75rem;
		display: grid;
		gap: 0.5rem;
	}
	.snow-message-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.snow-textarea {
		width: 100%;
		font: inherit;
		line-height: 1.6;
		padding: 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-control);
		background: var(--paper-raised);
		&[readonly] {
			background: var(--parchment);
		}
	}
	.snow-gloss-toggle {
		justify-self: start;
		background: none;
		border: none;
		padding: 0;
		color: var(--evergreen);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}
	.snow-gloss pre {
		white-space: pre-wrap;
		font: inherit;
		background: var(--parchment);
		padding: 0.75rem;
		border-radius: var(--radius-control);
		margin: 0;
	}
	.snow-destination {
		font-weight: 600;
		color: var(--ink);
	}
	.snow-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.snow-add {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
		max-width: 28rem;
		input,
		select {
			width: 100%;
		}
	}
</style>
