<template>
	<div
		class="interview-widget"
		data-testid="interview-agent-widget"
	>
		<elevenlabs-convai
			:agent-id="agentId"
			:language="language"
			:dynamic-variables="dynamicVariablesJson"
		></elevenlabs-convai>
	</div>
</template>

<script lang="ts" setup>
	import { computed } from 'vue';

	// The ElevenLabs Conversational AI web widget (public agent embed). The
	// element is only rendered after the consent gate completes and the
	// server issued the interview id — the page never mounts it before
	// consent, so a conversation can never begin unconsented. The
	// server-issued interview id travels as a dynamic variable so the
	// server-to-server post-call webhook can match the transcript to this
	// interview even after the owner has left the page. The business
	// context variables keep the same names the agent's prompt expects
	// ({{web_business_context}}, {{web_intake_complete}}).
	const props = defineProps<{
		/** Public agent id from /api/voice/config (not a secret). */
		agentId: string;
		/** Server-issued interview id for the post-call webhook match. */
		interviewId: string;
		/** Widget language preset ('ja' | 'en'). */
		language: string;
		/** Business intake snapshot for {{web_business_context}}. */
		businessName: string;
		location: string;
	}>();

	const dynamicVariablesJson = computed(() => {
		const context =
			props.businessName.trim() || props.location.trim() ?
				{
					business_name: props.businessName,
					location: props.location,
				}
			:	{};
		return JSON.stringify({
			interview_id: props.interviewId,
			web_business_context: JSON.stringify(context),
			web_intake_complete: true,
		});
	});
</script>

<style lang="scss" scoped>
	.interview-widget {
		min-height: 12rem;
	}
</style>
