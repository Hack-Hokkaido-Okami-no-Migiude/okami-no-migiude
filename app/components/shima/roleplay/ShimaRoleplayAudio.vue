<script setup lang="ts">
	import {
		type ShimaRoleplayClipId,
		shimaRoleplayClips,
		shimaRoleplayCredit,
	} from './roleplay-clips';
	import {
		type ShimaRoleplayMediaEvent,
		createShimaRoleplayPlayer,
	} from './roleplay-player';

	// Static fixture playback only: user-triggered, same-origin WAV files, no
	// microphone, no provider, no evidence writes. Deliberately separate from
	// the authenticated live-voice interview UI in app/components/shima/voice/.
	function openRoleplayMedia(id: ShimaRoleplayClipId) {
		if (typeof Audio === 'undefined') {
			return null;
		}
		const clip = shimaRoleplayClips.find((item) => item.id === id);
		if (!clip) {
			return null;
		}
		const element = new Audio(clip.src);
		element.preload = 'none';
		return {
			play: () =>
				new Promise<void>((resolve, reject) => {
					const started = element.play();
					if (started) {
						started.then(() => {
							resolve();
						}, reject);
						return;
					}
					resolve();
				}),
			pause: () => {
				element.pause();
			},
			on: (kind: ShimaRoleplayMediaEvent, handler: () => void) => {
				element.addEventListener(kind, handler);
			},
			dispose: () => {
				element.pause();
				element.removeAttribute('src');
				element.load();
			},
		};
	}

	const player = createShimaRoleplayPlayer(openRoleplayMedia);
	const snapshot = shallowRef(player.snapshot());
	const stopListening = player.subscribe(() => {
		snapshot.value = player.snapshot();
	});
	onBeforeUnmount(() => {
		stopListening();
		player.stopAll();
	});
</script>

<template>
	<section
		class="shima-roleplay"
		data-testid="shima-roleplay"
		aria-label="事前録音の架空ロールプレイ（マイクなし）"
	>
		<p class="shima-kicker">録音で聞く（事前録音・架空・マイクなし）</p>
		<ul class="shima-roleplay-controls">
			<li
				v-for="clip in shimaRoleplayClips"
				:key="clip.id"
			>
				<button
					class="button"
					type="button"
					:data-testid="`shima-roleplay-play-${clip.id}`"
					:aria-pressed="snapshot.status[clip.id] === 'playing'"
					@click="player.toggle(clip.id)"
				>
					{{
						snapshot.status[clip.id] === 'playing' ?
							clip.stopLabel
						:	clip.label
					}}
				</button>
				<span class="quiet">{{ clip.durationLabel }}</span>
			</li>
		</ul>
		<details data-testid="shima-roleplay-transcript">
			<summary>録音の内容（文字・すべて架空）</summary>
			<dl>
				<div
					v-for="clip in shimaRoleplayClips"
					:key="clip.id"
				>
					<dt>{{ clip.speaker }}</dt>
					<dd>{{ clip.caption }}</dd>
				</div>
			</dl>
		</details>
		<p
			v-if="snapshot.notice"
			class="quiet"
			role="status"
			data-testid="shima-roleplay-unavailable"
		>
			{{ snapshot.notice }}
		</p>
		<p
			class="quiet"
			data-testid="shima-roleplay-credit"
		>
			{{ shimaRoleplayCredit.label }}
			<a :href="shimaRoleplayCredit.termsHref">{{
				shimaRoleplayCredit.termsLabel
			}}</a>
		</p>
	</section>
</template>

<style scoped>
	.shima-roleplay-controls {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 1rem;
	}
</style>
