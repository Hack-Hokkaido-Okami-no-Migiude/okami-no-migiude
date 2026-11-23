<template>
	<div>
		<header class="masthead">
			<a
				class="skip-link"
				href="#workbench-main"
				>Skip to workbench</a
			>
			<div class="identity">
				<svg
					viewBox="0 0 40 40"
					width="40"
					height="40"
					aria-hidden="true"
				>
					<rect
						x="1"
						y="1"
						width="38"
						height="38"
						rx="7"
						fill="none"
						stroke="currentColor"
					/>
					<path
						d="M8 27 18 13l6 7 3-4 5 7M8 31h24M25 10h6m-3-3v6"
						fill="none"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<div>
					<strong>Sapporo Workbench</strong
					><span>Workflow discovery &amp; automation planning</span>
				</div>
			</div>
			<span
				class="location"
				lang="ja"
				>札幌 <span aria-hidden="true">/</span> 北海道</span
			>
		</header>
		<main
			id="workbench-main"
			tabindex="-1"
		>
			<slot />
		</main>
	</div>
</template>

<style scoped>
	.masthead {
		min-height: 4.2rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.65rem clamp(0.8rem, 2.3vw, 2rem);
		background: var(--pine-dark);
		color: #f9f3df;
		border-bottom: 3px solid #a38649;
	}
	.identity {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.identity svg {
		flex: none;
		color: #d8bd7e;
	}
	.identity strong {
		display: block;
		font: 400 1.24rem/1.2 var(--serif);
	}
	.identity span {
		display: block;
		color: #d8dfce;
		font-size: 0.73rem;
	}
	.location {
		text-transform: uppercase;
		font: 700 0.75rem var(--mono);
		color: #e7d6ac;
		white-space: nowrap;
	}
	.skip-link {
		position: absolute;
		z-index: 3;
		transform: translateY(-250%);
		background: var(--surface);
		color: var(--pine);
		padding: 0.5rem;
		border-radius: 0.25rem;
	}
	.skip-link:focus {
		transform: none;
	}
	@media (max-width: 430px) {
		.location {
			display: none;
		}
	}
</style>
