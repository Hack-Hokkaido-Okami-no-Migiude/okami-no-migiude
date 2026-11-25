<!-- Fallback/original-text view: renders Markdown blocks as plain Vue text
     nodes rather than interpreting the report as HTML. -->
<template>
	<div class="report-markdown">
		<template
			v-for="(block, index) in blocks"
			:key="index"
		>
			<h2
				v-if="block.kind === 'heading' && block.level <= 2"
				class="report-markdown__heading"
			>
				{{ block.text }}
			</h2>
			<h3
				v-else-if="block.kind === 'heading'"
				class="report-markdown__subheading"
			>
				{{ block.text }}
			</h3>
			<blockquote
				v-else-if="block.kind === 'quote'"
				class="report-markdown__quote"
			>
				{{ block.text }}
			</blockquote>
			<ul
				v-else-if="block.kind === 'bulletList'"
				class="report-markdown__list"
			>
				<li
					v-for="(item, i) in block.items"
					:key="`b${i}`"
				>
					{{ item }}
				</li>
			</ul>
			<ol
				v-else-if="block.kind === 'orderedList'"
				class="report-markdown__list"
			>
				<li
					v-for="(item, i) in block.items"
					:key="`o${i}`"
				>
					{{ item }}
				</li>
			</ol>
			<hr
				v-else-if="block.kind === 'divider'"
				class="report-markdown__divider"
			/>
			<p
				v-else
				class="report-markdown__paragraph"
			>
				{{ block.text }}
			</p>
		</template>
	</div>
</template>

<script lang="ts" setup>
	import { computed } from 'vue';
	import { renderMarkdownBlocks } from '~/utils/report-content';

	const props = defineProps<{ content: string }>();

	const blocks = computed(() => renderMarkdownBlocks(props.content));
</script>

<style lang="scss" scoped>
	.report-markdown {
		&__heading {
			font-size: 1.2rem;
			font-weight: 700;
			margin: 1.25rem 0 0.5rem;
		}

		&__subheading {
			font-size: 1rem;
			font-weight: 600;
			margin: 1rem 0 0.375rem;
		}

		&__paragraph {
			margin: 0 0 0.75rem;
			white-space: pre-wrap;
		}

		&__list {
			margin: 0 0 0.75rem;
			padding-left: 1.25rem;
		}

		&__quote {
			border-left: 3px solid var(--bs-border-color);
			padding-left: 0.75rem;
			margin: 0 0 0.75rem;
			opacity: 0.85;
		}

		&__divider {
			opacity: 0.4;
			margin: 1rem 0;
		}
	}
</style>
