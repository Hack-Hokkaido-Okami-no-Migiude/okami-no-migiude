# Shima Enaga — provider decision

Audit: 2026-11-24, repository base `a840e5115aa5afe85eb873c893b77359bb394a46`. **Ship the zero-key fictional role-play first. For live voice, prefer Scribe v3 Live + ElevenLabs TTS with the app choosing and speaking one question at a time.** Use hosted ElevenAgents only if the product explicitly accepts that the agent—not Shima—generates and times its next spoken question. Do not build both live adapters for P0.

## Ownership and minimum scope

| Layer | Recommended owner |
| --- | --- |
| Speech recognition and synthesis | ElevenLabs Scribe v3 Live for owner audio; ElevenLabs TTS for only the selected question. No new speaker-identification feature. |
| Interview control | Shima chooses one question from a bounded Japanese-first question bank using the latest committed answer and evidence-backed gaps. Show the exact question as text; owner can select the next topic, skip/repeat a question, finish answering, correct the transcript, switch to typing, or end. Use the same controls with no key. |
| System of record | Shima's private client/session transcript, confirmed answers, and revisions. ElevenLabs events are inputs, not approval, verification, or publication authority. |
| Analysis and persistence | Reuse the existing transcript → analyze → reconcile/verify/propose path and single-process durable JSON store. Public quests and claims get their own server-allowlisted projection; never serialize a session, transcript, evidence, detailed graph, company identifier, or provider ID into the public response. |

## What ElevenAgents documents

**Private auth and transports.** The browser JS SDK is `@elevenlabs/client`, not the server REST SDK. For private agents (`platform_settings.auth.enable_auth: true`), the app backend authenticates/authorizes the owner and calls ElevenLabs with `xi-api-key`. Configure the approved agent ID server-side; don't accept an arbitrary agent ID or hostname from the browser. Provider auth is not app user authorization. The auth guide recommends either authenticated sessions or a provider hostname allowlist on the agent, not both; app-origin checks and rate limits still apply.[1][4]

| Transport | Server request to `https://api.elevenlabs.io` | Browser `Conversation.startSession` |
| --- | --- | --- |
| WebSocket | `GET /v1/convai/conversation/get-signed-url?agent_id=…` → `signed_url`. Use it verbatim; optional `include_conversation_id=true` makes the signature non-reusable (the current response schema lists only `signed_url`, not a top-level ID). The 15-minute expiration is to **establish** the socket; it does not close an established call.[2][4] | `{ signedUrl, connectionType: 'websocket' }`.[1] |
| WebRTC | `GET /v1/convai/conversation/token?agent_id=…` → `{ token, conversation_id }`. Omit optional `participant_name` rather than injecting an owner's name. Don't assume the signed URL's lifetime applies here.[3][1] | `{ conversationToken: token, connectionType: 'webrtc' }`; the latest JS guide defaults voice to WebRTC and text-only to WebSocket.[1] |

Authenticate the **app** session before minting. The only browser-bound credential on direct connect is the applicable short-lived bearer capability; keep it in memory, serve `Cache-Control: no-store`, redact query strings/headers and never return the long-lived key, provider response/error body or configuration. If *no provider credential at all* may reach the browser, use a same-origin server relay, not direct SDK connect. Keep provider IDs private and store only those required for linkage or deletion.

**Owner versus agent turns.** Set/check `conversation_config.conversation.client_events` for `user_transcript`, `agent_response`, `agent_response_correction`, and `interruption` without removing needed transport events. The finalized owner utterance arrives in `{ type: 'user_transcript', user_transcription_event: { user_transcript, event_id } }`, separate from tentative ASR. The JS source maps it to `onMessage({ role: 'user', source: 'user', message, event_id })`. Keep interim/tentative text out of evidence.[5][6][7]

`agent_response` is generated assistant text, not proof all of it played. After interruption, `agent_response_correction_event` reports `original_agent_response` and `corrected_agent_response`; the current wire schema also has `event_id` and `response_id`. SDK releases expose `onAgentResponseCorrection`; use `response_id` where exposed (otherwise correlate conservatively within the same transport), replace the matching assistant display row, and never append it as a new owner turn or overwrite owner speech. Enable and verify those events on the pinned SDK and chosen transport; review/correct misrecognized owner speech through Shima separately.[5][6][10]

**Context updates are not question control.** `conversation.sendContextualUpdate(text, { contextId })` sends `{ type: 'contextual_update', text, context_id }` (omit the optional ID if unsupported by the pinned version; released JS support starts at `@elevenlabs/client@1.5.0`).[7][10]
A newer matching ID supersedes the earlier update in the LLM view, not necessarily in stored history.[6]
Updates are async background/tool context, don't interrupt or trigger a turn, and do not replace the system prompt or guarantee delivery into an already-generating or immediately next reply.[8][9]
ElevenAgents' LLM page lists a 2 MB maximum system prompt size (instructions, knowledge base and other system context combined) and model-dependent context windows; that is not a documented per-update size or delivery guarantee.[48]
Send only small, approved hints before a new turn where possible, not the transcript. `sendUserMessage(text)` starts a turn as **user** input; don't use it to impersonate the owner.[1][8]
`sendUserActivity()` delays agent speech briefly, not a lock.[1] No documented browser method here guarantees “speak exactly this approved question next.”

A start-time `overrides.agent.prompt.prompt` replaces the prompt only with the corresponding Security override allowed; `overrides.agent.firstMessage`, `overrides.agent.language`, and `overrides.tts.voiceId` are also configuration-dependent start-time options.[11] Keep prompt/first-message overrides off unless specifically needed. `dynamicVariables` populate templates at initiation; configured tool results can update variables, but a model-invoked client tool is neither a guaranteed per-turn hook nor a trusted authorization mechanism.[12][46] Enterprise monitoring (`wss://api.elevenlabs.io/v1/convai/conversations/{conversation_id}/monitor`) is separate from ordinary SDK context updates and is not needed.[45]

**Language, time, reconnect.** Configure `conversation_config.agent.language: 'ja'` and an English preset under `conversation_config.language_presets.en.overrides` (e.g. `agent.first_message` and `tts.voice_id`); use `conversation_config.tts.voice_id` for the Japanese base voice.[14][18] Select locale before start; don't promise mid-call switching. Use workspace-approved native-sounding `ja`/`en` voices checked through `GET /v2/voices` (`language` filter, returned `voice_id`), not copied example IDs.[20] Model tables list Japanese and English for `eleven_multilingual_v2` and `eleven_flash_v2_5` (not `eleven_flash_v2` for Japanese); pin settings instead of relying on conflicting guide/default examples.[19] Voice availability, pronunciation of names/numbers and local terminology still require listening tests.

`conversation_config.conversation.max_duration_seconds` defaults to `600`; official range `60`–`7200`.[13]
Set a server-managed cap such as `2100` for a 30-minute interview with wrap-up margin, then read it back via `GET /v1/convai/agents/{agent_id}` after dashboard or `PATCH` configuration.[14][15]
The public docs support a setting above 30 minutes but do not establish this workspace's entitlement or a universal “>30 min requires Enterprise” rule.[13][16]
Published Free includes only 15 call minutes; Starter includes 75 (plan allowance, not per-call cap).[16]
Check account balance/overage, per-call enforcement, applicable commercial terms, concurrency and distinct inactivity settings (`conversation_config.turn.turn_timeout` and `silence_end_call_timeout`) before promising duration.[14][16]
Do a measured 31+ minute acceptance run only if explicitly authorized and provisioned.

Use `onStatusChange`, `onDisconnect`, `onError`, `getId()` and `endSession()`. SDK changelog notes WebRTC failure reasons (`reason: 'error'` from `@elevenlabs/client@1.36.1`; deliberate provider close remains `'agent'`). Once closed, preserve committed Shima turns, discard unrecoverable pending audio, and require owner-initiated resume with a fresh grant/new provider conversation, or continue by text. Do not promise same-room resume/replay after terminal disconnect. Experimental persistent **text** WebSocket sessions and the widget's voice continuation (starts a **new** conversation) are different features; don't rely on widget/browser history storage for private sessions.[1][17][47]

## Recommended live adapter: Scribe v3 Live + TTS

1. **Listen:** Server `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` with `xi-api-key` → `{token}` (15 minutes to use; single-use; optional `max_session_duration_seconds` limits the resulting connection, not the entire app interview). Browser uses the SDK (`Scribe.connect({ token, modelId: 'scribe_v3_live', … })`) or connects to `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with `token`, `model_id=scribe_v3_live`, `audio_format=pcm_16000` and `language_code=ja` or `en`. A server relay instead authenticates the socket with `xi-api-key`. Do not confuse `realtime_scribe` with the model ID or the repo's batch `scribe_v3`.[30][31][34]
2. **Commit:** Prefer the explicit “Finish answer” control in P0, using `commit_strategy=manual` and `input_audio_chunk` fields `audio_base_64`, `sample_rate`, `commit` (SDK `commit()`). Never infer that one STT segment means an owner finished answering: the model may auto-commit at about 36 seconds even in manual mode. Combine committed segments for the current question before advancing; `partial_transcript` is display-only, and `committed_transcript` is the final text of a segment. If using `include_timestamps=true`, `committed_transcript_with_timestamps` is additional metadata, not a second transcript. VAD auto-segments on silence; `turn_prediction` is v3 Live only, documented at `turn_probability >= 0.9` with VAD fallback, and the commit guide says to use the raw socket when the SDK enum lacks it. Neither detector is needed for app-owned progression.[30][32][33]
3. **Speak:** On the server call `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128` with `xi-api-key` and `{ text: selectedQuestion, model_id: 'eleven_flash_v2_5', language_code: 'ja' }` (or `en`). The model must support the language; omit `language_code` if opting for `eleven_multilingual_v2`, which doesn't accept this override. Stream audio or keep the question visible if audio fails; never send the whole transcript to TTS. For P0, stop forwarding mic audio during playback, offer mute/repeat/skip, and do not promise hands-free playback, full duplex or barge-in.[19][35]
4. **Recover:** Turn off capture on stop, consent withdrawal, disconnect, navigation or cap; correlate late events with their transport epoch. Reopen only by explicit owner action/new token; preserve app state, not provider state. Scribe documents a 15-second limit without client messages (keepalives require streamed audio), `session_time_limit_exceeded`, and optional first-chunk-only `previous_text` (best under 50 chars; omit by default). Use text during interruption or intentional pauses, not silent indefinite streaming. Treat Scribe account session limits, credits/terms and 30-minute uninterrupted operation as unverified; shorter connections can span the app interview if the owner elects to resume.[30][32][33]

## Consent, retention and operating limits

- Before requesting microphone permission, minting a grant or transferring anything, show Japanese/English explicit opt-in to AI interaction, capture, ElevenLabs processing, potential third-party LLM processing when applicable, configured storage/region/retention and deletion limits. Require consent from all participants. Make cancel/text available without provider contact; consent to transcription is not consent to remote analysis, publication, or engineering commitments. ElevenAgents requires disclosure immediately prior to interaction. Real interviews stay disabled until app access control and operator disclosures are verified; a public/demo session uses fixtures only.[27][28]
- **Hosted Agents:** Set `platform_settings.privacy.record_voice=false`; explicitly configure `retention_days` and deletion targets (`delete_transcript_and_pii`, `delete_audio`; `apply_to_existing_conversations` only when authorized).[14][22]
  Disabling audio saving doesn't delete old recordings.[22]
  The retention guide says a two-year default, `-1` unlimited, `0` scheduled deletion; generated agent schema shows `-1` field default, so don't infer the workspace's effective policy.[14][21]
  Zero days is **not** the same as ZRM.[23] Use `DELETE /v1/convai/conversations/{conversation_id}` for explicit provider cleanup and check that exact ID separately with `GET` where available.[25][26]
- **Zero retention and data use:** Verify actual workspace eligibility/config (account-level restrictions, product/model/region); Agents uses `platform_settings.privacy.zero_retention_mode`, possibly enforced workspace-wide.[23][24]
  Scribe and TTS use `enable_logging=false` on their respective socket/request with eligible Enterprise access, not a free boolean privacy switch.[24][30][35]
  If the municipality requires this setting for every Scribe connection, enforce it in a server relay rather than trusting a browser-supplied query parameter.
  By default vendor storage is US; documented Enterprise storage regions EU/India/Singapore do not automatically constrain all processing.[28]
  Check the account's **Terms and privacy → Data use → Improve the models for everyone** setting separately.[29]
  The ZRM guide says normal deletion may leave debugging/moderation data; deleted database items remain in backups for up to 30 days.[24] Do not promise absolute purge, Japan residency, or private-by-hosting alone.
- **Separate delete contracts:** Scribe transcript deletion is `DELETE /v1/speech-to-text/transcripts/{transcription_id}`, not the existing `server/audio/provider.ts`/README path `DELETE /v1/speech-to-text/{id}`. Flag the existing recorded-audio route/stub for a separate correction before any real upload; its stub cannot validate the external path. The realtime reference exposes `session_started.session_id`, not a documented deletable `transcription_id`; do not equate them or claim realtime per-session purge. TTS history deletion is `DELETE /v1/history/{history_item_id}` if an actual history ID is available; do not equate it to a generation request ID. Report local deletion and provider cleanup (confirmed, unavailable/pending, failed) separately; don't persist raw audio or vendor responses just to support deletion.[30][36][37]
- **Proposed app bounds, not provider guarantees:** private server config `NUXT_ELEVENLABS_API_KEY`, `NUXT_ELEVENLABS_VOICE_ID_JA` and optional `NUXT_ELEVENLABS_VOICE_ID_EN` (or `NUXT_ELEVENLABS_AGENT_ID` for the alternative); off by default. Fixed official host (trusted loopback stubs only), bounded payload/audio response, no redirects, short failures (e.g. 8 s grants, 15 s TTS, 5 s waiting for a final segment after owner finishes, then manual text recovery); app warning near 28 min, wrap by 30 with a short bounded grace, hard stop by 35. Cap one live capture per session and mint by authorized same-origin POST after consent. The TTS route resolves the current question ID to server-approved text/voice, not a general speech proxy. No automatic paid retry or mode downgrade. Never log transcripts, provider URLs with credentials, or live provider bodies. Disable optional tools, webhooks and secondary processors by default.

## Proposed adapter seam and zero-key acceptance

- Normalize adapter events to `partial {epoch, text}` (ephemeral), `commit {epoch, eventKey, questionId, text, startMs?, endMs?}`, `closed {epoch, reason}`. Persist idempotently by private `(clientId, sessionId, epoch, eventKey)` or owner-action ID, not by text. Owner-only mic makes `speaker` an explicit input role, not inferred identity. Times remain null if unavailable. Keep the app question as UI/dialogue metadata; never score it as owner evidence. A normalized final candidate is still reviewable speech recognition, not proof of a fact.
- Serialize writes through the existing transcript store/CAS boundary. `PUT /api/clients/:clientId/sessions/:sessionId/transcript` replaces the full ordered list with `baseRev`; preserve existing rows, let the server assign new segment IDs, retain IDs and let it bump `sourceRev` for corrections. A 409 reloads/reconciles against the latest revision, never overwrites paste edits. Run `POST …/analyze` against the durable latest revision, coalesced at most once per committed answer batch and cancel/ignore stale results. Keep live analysis's separate `allowExternal:true` gate; align any new source discriminator with the shared contract (`paste`/`audio` only in the audited base). Do not bypass citation invalidation or existing proposal staleness. The stock hotel fixture accepts a seeded transcript and exact follow-up answer only; use that supported path or an explicitly added fictional variant, not a fixture masquerading as analysis of free-form input.
- Role-play: visible **「ロールプレイ（架空・マイクなし）」 / “Fictional role-play — no microphone or live AI”**. Owner picks a topic or reveals a labeled fictional owner line; same state machine commits it, updates the real fixture-backed Map, proposes a package, lets the owner separately confirm budget and approve the exact sanitized preview, and exposes a claim that survives reload. Prefer no audio to a fake live demo; any bundled audio must be conspicuously labeled prerecorded. No SDK connection, mic permission, credentials or outside network. Test this in an independent browser, including double-submit, editing/citation invalidation, consent denial and failure, plus public list/detail/claim payloads against private sentinels. Stub provider failures locally as distinct from role-play.

## Wider provider choices

| Provider | Documented capability | P0 decision |
| --- | --- | --- |
| Dify | Server Bearer `POST /v1/chat-messages`: `query`, `inputs`, `user`, prior `conversation_id` for continuity, `response_mode`. Its own license is modified Apache 2.0 with multi-tenant/frontend conditions, not MIT.[38][39] | Defer. Another dialogue store/configuration is unnecessary. Review licensing, model subprocessors and conversation deletion before adopting as an optional sidecar. |
| OrcaRouter | OpenAI-compatible `https://api.orcarouter.ai/v1`, Bearer `POST /v1/chat/completions`, provider-prefixed model IDs; advertises JSON modes.[40][41] | Best optional extraction candidate: configure existing `NUXT_LLM_BASE_URL`, `NUXT_LLM_API_KEY`, `NUXT_LLM_MODEL` with a supported pinned model; no adapter or routing fallback required. Keep strict validation and separate disclosure for gateway + upstream; compatibility, quality and retention for the chosen path are not verified. |
| Linkup | Bearer `POST https://api.linkup.so/v1/search` with `q`, `depth`, `outputType` (`searchResults`, `sourcedAnswer`, `structured`); optional domain filters, structured schema.[42] | Defer to opt-in desk research with public/non-sensitive queries. A search result isn't owner evidence or a subsidy/price guarantee. |
| Neo4j | Cypher property graph with ACID writes and edition-dependent access controls.[43] | Defer. Existing evidence-backed steps/edges are enough; don't duplicate sensitive workflow data in a graph DB. |
| Neon | Postgres over server-only `DATABASE_URL`; JS HTTP for one-shot/non-interactive transactions, `Pool`/`Client` WebSocket for interactive transactions.[44] | Defer until multiple app instances require shared durability. Then use a repository adapter against standard Postgres (Neon optional), with one atomic conditional claim/unique assignment. Keep local JSON for the single-process demo. |

## Verification and release blockers

**Independently checked:** repo base and clean start, `README.md`, `.env.example`, transcript/analysis seams and recorded-audio delete URL; official docs and public SDK source for the fields/events above. Existing tests for transcript input/revisions, citation cascade and the hotel fixture passed (17 tests). No project `.env` at audit; no nonempty ElevenLabs key, agent ID or per-language voice ID, `NUXT_LLM_*` live settings, or checked Dify/OrcaRouter/Linkup/Neo4j/Neon credentials in the process environment. Only names/presence were reported; unrelated inference credentials were not consulted, no secret values were printed, and no provider calls or sample transfers were made.

**Docs only / not run:** provider authentication, SDK delivery/order, Japanese/English audio quality, the 30+ minute and disconnect scenarios, effective workspace privacy/deletion, and the proposed Shima role-play browser flow. This is a research handoff, not an implemented or verified demo. Before enabling live use, obtain project-scoped credentials/voice IDs, confirm account settings and quotas, correct the batch delete mismatch separately, then test only with explicitly approved fictional content. Until then label live voice unverified and leave it off.

## Sources

[1] https://elevenlabs.io/docs/eleven-agents/libraries/java-script
[2] https://elevenlabs.io/docs/api-reference/conversations/get-signed-url
[3] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token
[4] https://elevenlabs.io/docs/eleven-agents/customization/authentication
[5] https://elevenlabs.io/docs/eleven-agents/customization/events/client-events
[6] https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
[7] https://raw.githubusercontent.com/elevenlabs/packages/main/packages/client/src/BaseConversation.ts
[8] https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
[9] https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets
[10] https://elevenlabs.io/docs/changelog/2026/5/13
[11] https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides
[12] https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables
[13] https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
[14] https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get
[15] https://elevenlabs.io/docs/eleven-agents/api-reference/agents/update
[16] https://elevenlabs.io/pricing/agents
[17] https://elevenlabs.io/docs/changelog/2026/10/19
[18] https://elevenlabs.io/docs/eleven-agents/customization/voice/customization/language
[19] https://elevenlabs.io/docs/overview/models
[20] https://elevenlabs.io/docs/api-reference/voices/search
[21] https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention
[22] https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving
[23] https://elevenlabs.io/docs/eleven-agents/customization/privacy/zrm
[24] https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode
[25] https://elevenlabs.io/docs/api-reference/conversations/delete
[26] https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get
[27] https://elevenlabs.io/docs/eleven-agents/legal/disclosure-requirement
[28] https://elevenlabs.io/docs/overview/administration/data-residency
[29] https://elevenlabs.io/docs/help-center/legal/is-my-data-used-to-improve-eleven-labs-ai-models
[30] https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
[31] https://elevenlabs.io/docs/api-reference/tokens/create
[32] https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies
[33] https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference
[34] https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
[35] https://elevenlabs.io/docs/api-reference/text-to-speech/stream
[36] https://elevenlabs.io/docs/api-reference/speech-to-text/delete
[37] https://elevenlabs.io/docs/api-reference/history/delete
[38] https://docs.dify.ai/en/api-reference/chat-messages/send-chat-message
[39] https://raw.githubusercontent.com/langgenius/dify/main/LICENSE
[40] https://docs.orcarouter.ai/getting-started/quickstart
[41] https://docs.orcarouter.ai/compatibility/openai-sdk
[42] https://docs.linkup.so/pages/documentation/endpoints/search/reference
[43] https://neo4j.com/docs/cypher-manual/current/introduction/cypher-neo4j
[44] https://neon.com/docs/serverless/serverless-driver
[45] https://elevenlabs.io/docs/eleven-agents/guides/realtime-monitoring
[46] https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools
[47] https://elevenlabs.io/docs/changelog
[48] https://elevenlabs.io/docs/eleven-agents/customization/llm — ElevenAgents models and system prompt size
