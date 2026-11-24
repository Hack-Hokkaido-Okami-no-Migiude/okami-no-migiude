# Server voice seam — frozen surface for the guarded relay route

Owner of this directory: **voice** (per `SHIMA-PILOT-CONTRACT.md` work order). This module is
**transport and connection lifecycle only**. It contains no routes, no store writes, no consent
checks, and no app wiring. The server/privacy worker owns route wiring, consent gates, and
persistence; this README freezes the seam it calls. Source of truth for decisions:
`SHIMA-PROVIDERS.md` (Scribe v3 Live + TTS, relay, bounds, retention) and
`SHIMA-PILOT-CONTRACT.md` (§ Consent and transport).

Seam version: `VOICE_SEAM_VERSION = 1` (from `server/voice/index.ts`). Bump it when any signature
below changes shape or meaning.

## Runtime dependency decision

- **Production transport: the Node runtime's native WHATWG `WebSocket` client. No new runtime
  dependency.** Node ≥ 22 (repo runs 26.x) provides it, and its non-standard constructor option
  `{ headers }` is required and used to send the documented `xi-api-key` handshake **header** so
  the credential never appears in a URL. Verified against the running runtime: the header arrives
  at the server, and a 3xx handshake response fails the connection (redirects are never followed).
- **Tests: `ws@8.23.0`** (loopback WebSocket server only). It is already in `node_modules` and the
  lockfile as a transitive dep of `crossws`/Nitro; the tests import it by name. Parent should
  promote it to `devDependencies` when wiring `tests/voice` into `npm run test:unit` (the
  `test:unit` glob list currently does not include `tests/voice/*.test.ts`; run them directly with
  `node --import tsx --test "tests/voice/*.test.ts"` until then). Production code never imports it.
- **Not used**: `@elevenlabs/client` (browser SDK — the relay authenticates with the server key
  instead), single-use token minting (that path is for browser-direct connect; the same-origin
  relay authenticates the socket itself, per the provider decision), and ElevenAgents entirely.

## What a guarded route does (and what it must enforce itself)

The adapter is built for a **same-origin relay**: browser → guarded Nitro route → fixed official
provider socket. The route (privacy worker) enforces — before touching this module — mode/actor/
membership checks, same-origin + CSRF rules, the consent receipt for `live-voice` for every
relevant participant, explicit operation confirmation, serialization of admission against
stop/revoke, and the Japanese notice (including `LIVE_VOICE_DISCLOSURE` from `tts.ts`) before any
provider contact. This module assumes it is called by an authorized server principal only.

Suggested wiring (not implemented here, no `server/api` changes were made):

1. `POST S/shima/interview/start {baseRev, confirmLiveVoice: true}` → route checks consent, then
   `registry.acquire(scopeKey)` → persist `{rev, epoch}` (typed reference only — never audio or
   provider bodies). One epoch per session at a time.
2. `GET S/shima/interview/stream` (WebSocket upgrade only) → route authenticates + binds to the
   epoch, then `connectScribeSession(...)`, forwards browser PCM chunks via
   `handle.sendAudioChunk`, and forwards normalized events back over the same-origin socket.
3. `POST S/shima/interview/stop {baseRev, epoch}` → `handle.stop()` (idempotent, closes the named
   epoch even on stale revision) + `epoch.release()`; commit final text through the common
   transcript commit path with `baseRev`/CAS.
4. Question speech: the route resolves the **server-chosen** question id to its approved text and
   calls `speakApprovedQuestion`; the browser transcript/command channel never supplies the text.
   Mic forwarding is paused during playback (route's job); `awaitFinalCommit` gives the ≤ 5 s
   final-segment wait; text recovery is explicit on `false`.

## Frozen signatures

```ts
// config.ts — fail closed; env-injectable for tests
voiceProviderConfig(env?): VoiceProviderConfig           // throws StageError 'provider_unconfigured'
voiceIdForLanguage(config, language): string             // throws StageError 'provider_unconfigured'
officialWsBase(baseUrl?): string
VOICE_LANGUAGES: ['ja', 'en']; type VoiceLanguage = 'ja' | 'en'
SCRIBE_MODEL_ID 'scribe_v3_live'; SCRIBE_AUDIO_FORMAT 'pcm_16000'; SCRIBE_SAMPLE_RATE 16000;
SCRIBE_COMMIT_STRATEGY 'manual'; SCRIBE_ENABLE_LOGGING false;
TTS_MODEL_ID 'eleven_flash_v2_5'; TTS_OUTPUT_FORMAT 'mp3_44100_128'

// epoch.ts — one bounded active epoch per scope (process-local)
const registry = new VoiceEpochRegistry()
registry.acquire(scopeKey, {lifetimeMs?, idFactory?, clock?}): VoiceEpoch   // throws VoiceError 'epoch_active'
registry.activeEpochId(scopeKey): string | null
VoiceEpoch = { id, scopeKey, startedAtMs, release() }    // release idempotent; lifetime auto-release

// scribe.ts — Scribe v3 Live relay adapter
connectScribeSession({config, language, epoch, onEvent, onNotice?, signal?, socketFactory?, clock?})
  : Promise<ScribeHandle>   // resolves after session_started; rejects StageError 'provider_failed'
ScribeHandle = {
  epoch, language, closed (getter), done: Promise<ScribeCloseInfo>,
  sendAudioChunk(bytes: Uint8Array, {commit?}?), commitSegment(),
  awaitFinalCommit(timeoutMs?): Promise<boolean>,   // false = no final in time → text recovery
  stop(),                                            // idempotent, reason 'stopped'
  abort(),                                           // idempotent, reason 'aborted'
}
ScribeEvent =
  | { kind: 'partial', epoch, text }                                   // ephemeral, never persist
  | { kind: 'commit', epoch, eventKey, text, startMs: null, endMs: null } // the ONLY persistable event
  | { kind: 'closed', epoch, reason, providerCode }                     // terminal, exactly once
ScribeCloseReason = 'stopped' | 'aborted' | 'idle_timeout' | 'session_cap'
                  | 'provider_error' | 'provider_closed' | 'protocol_error'
ScribeNotice = { code: 'retention_zero_not_applied' }

// tts.ts — server-chosen question only
speakApprovedQuestion({config, question: {questionId, language, text}, fetchImpl?})
  : Promise<{contentType, bytes: Buffer}>
assertApprovedQuestion(question); LIVE_VOICE_DISCLOSURE: string

// errors.ts
StageError codes reused: 'provider_unconfigured' (503) | 'provider_failed' (502) | 'invalid_model_output' (502)
VoiceError codes (route maps itself): 'epoch_active' → 409 typed | 'epoch_not_active' |
  'chunk_too_large' (server misuse) | 'question_invalid' → 400
PROVIDER_ERROR_CODES + providerErrorPhrase(code): fixed enum + fixed phrases (no provider text)

// socket.ts (transport detail; injectable for tests)
openNodeWebSocket(url, headers): VoiceSocketLike   // native client, header auth, no redirects
```

## Normalization and lifecycle rules (tested)

- Socket URL: fixed official origin (`wss://api.elevenlabs.io` unless loopback override) with
  exactly `model_id=scribe_v3_live&audio_format=pcm_16000&commit_strategy=manual&language_code=ja|en&enable_logging=false`;
  auth via the `xi-api-key` handshake header. Query params are server-constructed; nothing
  browser-supplied enters the provider URL.
- Manual commits: `commitSegment()` sends the official SDK's commit shape — an `input_audio_chunk`
  with empty `audio_base_64`, `commit: true`, `sample_rate: 16000`. `sendAudioChunk` can also carry
  `commit: true` ("finish answer" on the last chunk).
- Only `committed_transcript` is final ("turn finals only"): it becomes a `commit` event with
  1-based `eventKey` per epoch and null times (the plain event carries no timestamps;
  `include_timestamps` stays off so no second transcript exists). `partial_transcript` (including
  empty keepalives and repeated text) is `partial` — display-only. `turn_probability` and the
  legacy `final_transcript` type are ignored; `commit_strategy=turn_prediction` is never enabled.
- Provider error frames (`auth_error`, `session_time_limit_exceeded`, …) close the epoch with
  reason `provider_error` + the fixed provider code; the provider's own message string is never
  read, logged, or echoed. Unknown/undocumented frames are ignored and counted.
- Bounded lifecycle (clock-injectable): idle close after `idleAudioMs` (12 s) with nothing
  forwarded — deliberately below the provider's hard 15 s no-client-message limit; hard
  `session_cap` close at `maxSessionMs` (35 min); external `AbortSignal` → `aborted`; `stop()`/
  `abort()` idempotent; after close, late provider frames are discarded, timers cleared, the
  signal listener removed, and `done` resolves exactly once. A connection that never receives
  `session_started` rejects with `provider_failed` after `socketOpenMs` (8 s) and emits **no**
  `closed` event. One epoch's events are always tagged with its `epoch` id so late results from a
  previous epoch can never be admitted for a new one (the route filters by active epoch).
- TTS: one POST to `/v1/text-to-speech/{voiceId}/stream?output_format=mp3_44100_128&enable_logging=false`
  with JSON `{text, model_id, language_code}`, `redirect: 'error'`, 15 s timeout, response
  content-type must be `audio/*`, body streamed under a 1 MB cap, no retries and no automatic
  fallback (the question stays visible as text on failure). The question id/text must be resolved
  server-side; `question_invalid` guards free browser text. `fetchImpl` is the stub injection
  point — tests never touch the network, and a missing per-language voice id fails closed with
  `provider_unconfigured`.

## Redaction and retention disclosure

- Fixed phrases + fixed codes only, in errors and logs (`errors.ts`, `scribe.ts`). Never logged or
  returned: transcripts/commit text, provider error bodies, provider URLs, the API key, question
  text, or provider session ids (the realtime `session_started.session_id` has **no** documented
  deletion endpoint, so it is deliberately not even exposed).
- `LIVE_VOICE_DISCLOSURE` (tts.ts) is the retention/processing disclosure block for the Japanese
  notice: relay to ElevenLabs realtime STT + TTS, zero retention requested but granted only for
  eligible accounts, default retention / possible US storage otherwise, no raw audio stored by
  this app, stop/revoke always available, typed alternative always available. Realtime Scribe
  sessions have no documented per-session purge; do not claim deletion for them. Zero retention
  mode is enterprise-only — if the provider reports it was not applied, the adapter surfaces
  `retention_zero_not_applied` (fixed code) and the route/operator should treat the session as
  logged.

## Config (env)

`NUXT_ELEVENLABS_API_KEY` (required, fail closed), `NUXT_ELEVENLABS_VOICE_ID_JA` (required for
Japanese question speech), `NUXT_ELEVENLABS_VOICE_ID_EN` (optional), `NUXT_ELEVENLABS_BASE_URL`
(official HTTPS default; loopback test override only, mirroring the recorded-audio rule). All
bounds live in `config.ts` (`timeouts`, `caps`) and are plain fields a test may shrink.

## Test map (`tests/voice/`, in-process, zero external calls)

- `scribe.test.ts` — normalization, eventKey sequence, commit/partial semantics, error/unknown
  frames, redaction, manual commit wire shape, idle/cap/abort/stop, finalize wait, fake clock.
- `scribe-relay.test.ts` — real dialer against a loopback WS server: exact query set, header auth
  with key absent from the URL, redirect handshake rejected, provider close/error paths.
- `tts.test.ts` — injected fetch: exact URL/headers/body, redirect refusal, cap, content-type,
  question guard, redaction, fail-closed voice ids.
- `config.test.ts`, `epoch.test.ts`, `seam.test.ts` — fail-closed config, loopback override,
  bounds sanity, single-active-epoch rules, frozen barrel surface.
