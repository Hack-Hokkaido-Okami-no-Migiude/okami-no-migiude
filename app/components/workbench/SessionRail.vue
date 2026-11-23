<script setup lang="ts">
	import type {
		Client,
		Session,
		SessionSummary,
	} from '#shared/p0/types';

	const props = defineProps<{
		clients: Client[];
		sessions: SessionSummary[];
		clientId: string;
		session: Session | null;
		busy: boolean;
		createClient: (name: string) => Promise<boolean>;
		createSession: (title: string) => Promise<boolean>;
	}>();
	const emit = defineEmits<{
		browse: [id: string];
		open: [clientId: string, sessionId: string];
		demo: [];
	}>();
	const clientName = ref('');
	const sessionTitle = ref('');
	const controlsOpen = ref(false);

	async function addClient() {
		if (
			clientName.value.trim()
			&& (await props.createClient(clientName.value))
		) {
			clientName.value = '';
		}
	}
	async function addInterview() {
		if (
			sessionTitle.value.trim()
			&& (await props.createSession(sessionTitle.value))
		) {
			sessionTitle.value = '';
		}
	}
</script>

<template>
	<aside
		class="session-rail"
		aria-labelledby="session-rail-heading"
	>
		<div class="rail-heading">
			<div>
				<p class="eyebrow">Local workspace</p>
				<h2 id="session-rail-heading">Client interviews</h2>
			</div>
			<button
				v-if="session"
				class="button rail-toggle"
				type="button"
				aria-controls="client-controls"
				:aria-expanded="controlsOpen"
				@click="controlsOpen = !controlsOpen"
			>
				{{ controlsOpen ? 'Hide controls' : 'Show controls' }}
			</button>
		</div>
		<div
			id="client-controls"
			:data-collapsed="session && !controlsOpen ? '' : undefined"
		>
			<label
				class="browse-label"
				for="client-selector"
				>Client</label
			>
			<select
				id="client-selector"
				:value="clientId"
				:disabled="busy"
				@change="
					emit('browse', ($event.target as HTMLSelectElement).value)
				"
			>
				<option value="">Choose a client</option>
				<option
					v-for="client in clients"
					:key="client.id"
					:value="client.id"
				>
					{{ client.name }}
				</option>
			</select>
			<ul
				v-if="sessions.length"
				class="interview-list"
			>
				<li
					v-for="entry in sessions"
					:key="entry.id"
				>
					<button
						type="button"
						:aria-current="
							session?.id === entry.id ? 'true' : undefined
						"
						:disabled="busy || session?.id === entry.id"
						@click="emit('open', entry.clientId, entry.id)"
					>
						{{ entry.title }}
					</button>
				</li>
			</ul>
			<p
				v-else-if="clientId"
				class="quiet fine"
			>
				No interviews for this client yet.
			</p>
			<details
				v-if="clientId"
				class="create-record"
			>
				<summary>New interview</summary>
				<form
					class="stack"
					@submit.prevent="addInterview"
				>
					<label
						>Interview title
						<input
							v-model="sessionTitle"
							required
							:disabled="busy"
					/></label>
					<button
						class="button"
						type="submit"
						:disabled="busy || !sessionTitle.trim()"
					>
						Create interview
					</button>
				</form>
			</details>
			<details
				class="create-record"
				:open="clients.length === 0 || undefined"
			>
				<summary>New client</summary>
				<form
					class="stack"
					@submit.prevent="addClient"
				>
					<label
						>Client name
						<input
							v-model="clientName"
							required
							:disabled="busy"
					/></label>
					<button
						class="button"
						type="submit"
						:disabled="busy || !clientName.trim()"
					>
						Create client
					</button>
				</form>
			</details>
			<section
				class="sample-card"
				aria-labelledby="sample-heading"
			>
				<p class="eyebrow">Practice interview</p>
				<h3 id="sample-heading">The Sapporo hotel</h3>
				<p class="fine">
					Fictional interview · runs locally without a provider.
				</p>
				<button
					class="button"
					type="button"
					:disabled="busy"
					@click="emit('demo')"
				>
					Open hotel fixture demo
				</button>
				<p class="fixture-tag">Fixture demo — not live AI</p>
			</section>
		</div>
	</aside>
</template>

<style scoped>
	.session-rail {
		padding: 1.5rem 1.05rem;
		min-width: 0;
		border-right: 1px solid var(--line);
		background: var(--rail);
	}
	.session-rail h2 {
		margin: 0.25rem 0 1.15rem;
		font-size: 1.1rem;
	}
	.browse-label {
		display: block;
		margin-bottom: 0.35rem;
	}
	.rail-toggle {
		display: none;
	}
	.interview-list {
		list-style: none;
		padding: 0;
		margin: 0.65rem 0;
	}
	.interview-list button {
		width: 100%;
		text-align: left;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--ink);
		padding: 0.55rem 0.65rem;
	}
	.interview-list button[aria-current] {
		background: var(--soft);
		color: var(--pine);
		font-weight: 700;
		opacity: 1;
	}
	.create-record {
		border-top: 1px solid var(--line);
		margin-top: 0.75rem;
		padding-top: 0.65rem;
	}
	.create-record form {
		margin-top: 0.75rem;
	}
	.sample-card {
		margin-top: 1.75rem;
		border: 1px solid #d9c9a2;
		background: var(--sand);
		padding: 0.9rem;
		border-radius: 0.45rem;
	}
	.sample-card h3 {
		margin: 0.25rem 0;
		font-size: 1rem;
	}
	.sample-card .fixture-tag {
		margin: 0.55rem 0 0;
	}
	@media (max-width: 760px) {
		.session-rail {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.rail-heading {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 0.6rem;
		}
		.rail-toggle {
			display: inline-flex;
		}
		.session-rail:has([data-collapsed]) {
			padding-block: 0.75rem;
		}
		.session-rail:has([data-collapsed]) h2 {
			margin-bottom: 0.25rem;
		}
		#client-controls[data-collapsed] {
			display: none;
		}
	}
</style>
