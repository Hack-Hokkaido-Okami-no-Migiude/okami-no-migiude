<script setup lang="ts">
	import ShimaDemoIntake from '~/components/shima/ShimaDemoIntake.vue';
	import ShimaMatch from '~/components/shima/ShimaMatch.vue';
	import ShimaOpportunityMap from '~/components/shima/ShimaOpportunityMap.vue';
	import { useShimaDemo } from '~/composables/useShimaDemo';
	import { useShimaSurface } from '~/composables/useShimaSurface';

	// The private interview can be mounted here only with a verified server
	// principal and business/session authorization, never the demo UI mode.
	definePageMeta({ layout: false });
	useHead({ title: 'シマエナガ｜仕事の見取り図', htmlAttrs: { lang: 'ja' } });
	const surface = useShimaSurface();
	const demo = useShimaDemo();
	const {
		busy,
		problem,
		notice,
		needsRefresh,
		disabled,
		session,
		map,
		answer,
		activePackage,
		preview,
		quest,
	} = demo;
</script>

<template>
	<main class="shima-shell">
		<header class="shima-hero">
			<p class="shima-kicker">事業者向けセルフサービス</p>
			<h1>シマエナガ</h1>
			<p class="shima-tagline">
				日々の手作業を見直し、自分たちで変えられるところから。
			</p>
			<p>聞く → 見える化 → つなぐ</p>
		</header>
		<section
			v-if="surface !== 'fixture-local'"
			class="shima-panel"
			aria-labelledby="shima-access"
			data-testid="shima-owner-closed"
		>
			<h2 id="shima-access">事業者の方へ</h2>
			<p>
				面談の開始・再開には、ご自身の事業者アカウントの認証が必要です。この画面では面談を開始できません。
			</p>
			<NuxtLink
				v-if="surface === 'public-demo'"
				class="button"
				to="/quests"
				>架空のデモ掲示板を見る</NuxtLink
			>
		</section>
		<template v-else>
			<div class="shima-lane">
				<strong
					class="shima-tag"
					data-testid="shima-fictional-label"
					>ロールプレイ（架空・マイクなし）</strong
				>
				<nav
					class="shima-row"
					aria-label="デモとレビュー"
				>
					<NuxtLink to="/quests">デモ掲示板</NuxtLink>
					<NuxtLink to="/workbench">レビュー用ワークベンチ</NuxtLink>
				</nav>
			</div>
			<p
				class="shima-status"
				role="status"
				aria-atomic="true"
			>
				{{ busy || notice }}
			</p>
			<div
				v-if="problem"
				class="shima-warning"
			>
				<p role="alert">{{ problem }}</p>
				<button
					v-if="needsRefresh"
					class="button"
					type="button"
					data-testid="shima-owner-refresh"
					:disabled="!!busy"
					@click="session ? demo.refresh() : demo.prepareDemo()"
				>
					最新の状態を読み込む
				</button>
			</div>
			<ShimaDemoIntake
				:ready="!!session"
				:answer="answer"
				:stale="map?.stale ?? false"
				:disabled="disabled"
				@open="demo.prepareDemo"
				@answer="demo.submitAnswer"
			/>
			<ShimaOpportunityMap
				:session="session"
				:map="map"
				:answered="!!answer"
				:disabled="disabled"
				@record-effort="demo.recordEffort"
			/>
			<ShimaMatch
				:package="activePackage"
				:preview="preview"
				:quest="quest"
				:ready="!!answer && !!map"
				:stale="map?.stale ?? true"
				:disabled="disabled"
				@create="demo.createPackage"
				@decide="demo.decide"
				@reshape="demo.reshape"
				@preview="demo.makePreview"
				@publish="demo.publish"
				@refresh="demo.refresh"
				@complete="demo.complete"
			/>
		</template>
		<footer class="quiet">
			シマエナガは自治体の公式サービスではありません。
		</footer>
	</main>
</template>

<style lang="scss">
	@use '../styles/shima.scss';
</style>
