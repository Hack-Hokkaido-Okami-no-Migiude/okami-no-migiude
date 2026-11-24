# Sapporo workflow discovery — P0 slice

Transcript-to-plan workflow discovery for small businesses: paste an interview
transcript **or transcribe a recorded interview**, run evidence-backed
discovery, review the reconstructed workflow, and export an implementation plan
for one opportunity. This repository contains the P0 thin slice plus a
fictional hotel demo that exercises the whole path without calling any external
AI provider.

The demo client is **Hotel Yuki Sapporo — a fictional hotel** used as a test
fixture. Nothing in it describes a real business.

## Setup

```bash
npm install
```

Requirements: Node 24.15+ or 26.x (developed on Node 26.13.1), npm 11.x.

## Run

```bash
# Development server on http://localhost:3000
npm run dev

# Production build, then the supported launch (binds 127.0.0.1)
npm run build
npm start
```

`npm start` is a plain Node launch wrapper (`scripts/start.mjs`, no extra
dependencies) that keeps the server **local-only**: without any host setting it
binds to the loopback interface `127.0.0.1` on every platform. Operators who
genuinely need another interface set `NITRO_HOST` (or `HOST`) explicitly;
`NITRO_PORT`/`PORT` choose the port and `NITRO_UNIX_SOCKET` binds a Unix socket
instead. Data is persisted as a JSON snapshot under `NUXT_DATA_DIR` (default
`.data/`, repo-local and git-ignored). Point it anywhere writable for a session:

```bash
NUXT_DATA_DIR=.data npm run dev
```

## Live provider (optional)

Analysis runs in two modes. `fixture` mode (the demo default) needs no
credentials. `live` mode sends the transcript and saved answers to an external
LLM and is **off until all three variables are set**:

```bash
NUXT_LLM_BASE_URL=https://your-provider.example/v1
NUXT_LLM_API_KEY=<secret — server-side only, never logged>
NUXT_LLM_MODEL=<model name>
```

Live runs also require explicit per-request consent (`allowExternal: true`,
surfaced as a consent notice in the workbench). Without configuration, live
requests fail with `provider_unconfigured` (HTTP 503) — they never silently
fall back to the fixture.

> Live-provider behavior against real external providers is **unverified**: no
> credentials were available during development. What *is* verified by tests
> (`tests/smoke/p0-live.test.ts`, against a local OpenAI-compatible stub): the
> consent gate, untrusted-data separation in the prompt, identical reruns
> collapsing to `unchanged` without provider calls, malformed output failing as
> `invalid_model_output` without a retry, and 5xx responses retried exactly
> once — in every failure case the saved session is left byte-identical with
> no fixture fallback and no revision bump.

## Recorded-audio transcription (optional, P1)

The transcript editor also accepts a **recording file**. The recording is
uploaded once to the ElevenLabs speech-to-text batch API (model `scribe_v3`,
word-level timestamps, diarization) and returned as **unpersisted draft rows**
in the same row editor as pasted text. Draft rows are never written to the
session: a consultant relabels speakers (neutral `Speaker 1`, `Speaker 2` —
identity is never inferred), fixes timestamps, then saves through the same
CAS-guarded transcript PUT, which records `source: "audio"` for the persisted
transcript. The draft can simply be discarded. If the interview is **revised
while an upload is in flight** (an intentional CAS save included), the
finished draft is **not appended**; the control says so and the recording can
simply be uploaded again. Unsaved pasted draft rows are never touched by this
guard, and the CAS-guarded save itself is unaffected.

Consent and disclosure are mandatory: the control explains that **everyone in
the recording agreed to be recorded** and that the audio will be transferred
to the external transcription provider, whose default retention may store
content in the US (this app does not enable zero-retention mode and does not
claim it). The upload is rejected with `consent_required` (HTTP 422) before
any outbound request unless the checkbox is acknowledged.

Limits and safety properties (verified by tests, no real credentials needed):

- **Server-side only key** `NUXT_ELEVENLABS_API_KEY` — like the LLM key it is
  never sent to the browser, logged, or persisted. Without it the route fails
  closed with `provider_unconfigured` (HTTP 503) and makes no outbound call.
- **Fixed official endpoint** `https://api.elevenlabs.io` by default;
  `NUXT_ELEVENLABS_BASE_URL` may point at a **loopback-only** address for
  trusted local test configuration and is refused for anything non-loopback.
  The base URL is never accepted from request payloads.
- **Documented allowlist** (`.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.webm`),
  a 10 MiB cap, and a magic-byte signature check; the original filename is
  never forwarded, logged, or persisted (uploads are renamed to a generic
  basename before the provider call). The body must declare a **Content-Length
  within the cap before anything is buffered** — browsers and `fetch` always
  declare the size of a file upload, while chunked clients without a declared
  size are rejected with `invalid_input` before a single byte is read (a
  deliberate compatibility limit, not an oversight). The buffered parts are
  re-checked against the cap after reading as defense in depth.
- **One transcription attempt per upload** — no duplicate paid retries — with
  a 120 s transcription timeout, redacted failures (`provider_failed`,
  `invalid_model_output`; status codes and fixed phrases only, never provider
  bodies or credentials), **redirects rejected** on every provider call so the
  audio and key are never relayed to another endpoint, and the response
  **streamed under a byte cap** instead of being buffered unbounded. Provider
  failures never touch the saved transcript.
- **The raw audio and the provider response are never stored by this app.** A
  best-effort provider-side deletion (`DELETE /v1/speech-to-text/{id}`) runs
  for every schema-validated transcription id — including responses whose
  words turn out unusable, which fail with `invalid_model_output` and a fixed
  phrase that states the cleanup outcome honestly. Its result is reported
  verbatim in the response (`deleted` / `unavailable` / `failed`); retention
  beyond that depends on the provider account's logging settings.

Manual verification without credentials: run the bundled stub and generate a
synthetic recording, then drive the flow in a browser:

```bash
node --import tsx scripts/dev-audio-stub.mjs            # loopback stub on :9378
node scripts/make-sample-audio.mjs .data/sample.wav 2   # valid 2s WAV sample
NUXT_ELEVENLABS_API_KEY=stub-local NUXT_ELEVENLABS_BASE_URL=http://127.0.0.1:9378 npm run dev
```

Browser steps: open a client/session → transcript card → *Or transcribe a
recording* → accept the consent checkbox → choose the sample WAV → *Upload
recording* → review the returned Japanese draft rows (edit speaker labels and
times as needed) → **Save** (persists with `source: "audio"`) or *Discard
changes* (nothing persisted). Without the stub key set, the same flow shows
the fail-closed `provider_unconfigured` message instead.

## Verify

```bash
# Everything: builds the server, then unit suites (store/analysis/demo/ui),
# API suites over the built server, and both smoke files (fixture slice +
# live-provider stub). Exit code 0 only when all of them pass.
npm test

# Subsets, reusing an existing build when present:
npm run test:unit    # store, analysis, demo, ui suites (no server)
npm run test:api     # HTTP suites over the built server (dev-server fallback)
npm run test:smoke   # both smoke files against .output/server/index.mjs

# Typecheck (strict, project references)
npm run typecheck

# Fixture QA without a server build (tsx, runs the real discovery/proposal seam)
node --import tsx --test tests/demo/hotel-fixture.test.ts
```

`npm test` uses a repo-local ignored data dir and a free local port; it never
touches your `.data` directory and never calls the network.

## Hotel demo — user flow

1. Open the app and click **Open hotel fixture demo** (or `POST /api/demo/hotel`
   — idempotent). This seeds client `cli_hotel_demo`, session `ses_hotel_demo`
   with the twelve-person Hotel Yuki interview (9 transcript segments).
2. Click **Analyze fixture interview** — `POST /api/clients/cli_hotel_demo/sessions/ses_hotel_demo/analyze`
   with `{"baseRev":1,"mode":"fixture"}`. Discovery reconstructs steps
   `step_hotel_01` … `step_hotel_07`, edges `edge_hotel_01` … `edge_hotel_06`,
   one open question `q_hotel_01`, and opportunity `opp_hotel_01`
   (80 hours/month estimate). A quote that mentions two steps without any
   transition phrase is deliberately rejected and surfaces as an
   `ambiguous_match` review notice — no edge is invented from co-occurrence.
3. Answer `q_hotel_01` in the workbench. The fixture accepts **exactly one**
   documented answer (verbatim text in `HOTEL_DEMO_FOLLOWUP_ANSWER`,
   `server/demo/hotel.ts`); any other wording is rejected with
   `fixture_unsupported` (HTTP 422). The persisted answer keeps its real
   server-assigned id — the demo never binds evidence to canned ids.
4. Run analyze again. The follow-up variant (`hotel-demo-followup-v1`) adds
   step `step_hotel_08` (phone housekeeping about after-list room changes) and
   exception edge `edge_hotel_07`, grounded in quotes from the persisted
   answer, and creates opportunity `opp_hotel_02` — “Keep the housekeeping
   schedule current from confirmed room changes” (rules strategy,
   deterministic 40 occurrences × 15 minutes ⇒ 10 hours/month).
5. Propose for `opp_hotel_02` (`POST …/opportunities/opp_hotel_02/proposal`)
   → plan `plan_hotel_02` with proposed steps `pstep_hotel_03`, `pstep_hotel_04`
   and edge `pedge_hotel_02`. The base opportunity `opp_hotel_01` (plan
   `plan_hotel_01`) stays propose-able in the same session.
6. Download either plan via `GET …/opportunities/<id>/plan.md` — a markdown
   attachment (`implementation-plan.md`) with all seven sections and the
   labeled savings basis. Export is blocked (409 `stale_artifact`) while the
   proposal is stale; re-running analyze recomputes staleness from each
   proposal's basis — unchanged proposals re-enable, changed ones stay stale
   until regenerated.

## API surface (slice)

| Route                                                                                   | Purpose                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST /api/demo/hotel`                                                                  | Idempotent demo seed.                                          |
| `GET/POST /api/clients`, `GET/POST /api/clients/:clientId/sessions`                     | Client and session intake (scoped per client).                 |
| `GET /api/clients/:clientId/sessions/:sessionId`                                        | Full session snapshot.                                         |
| `PUT/DELETE /api/clients/:clientId/sessions/:sessionId/transcript`                      | Create/edit rows, or delete the transcript and derived work.   |
| `POST /api/clients/:clientId/sessions/:sessionId/transcribe`                            | Recording → unpersisted diarized draft rows (consent + allowlist). |
| `POST /api/clients/:clientId/sessions/:sessionId/analyze`                               | Discovery run (`fixture`/`live`, CAS via `baseRev`).           |
| `PATCH /api/clients/:clientId/sessions/:sessionId/steps/:stepId`                        | Consultant corrections (`verify` optional, evidence required). |
| `PUT /api/clients/:clientId/sessions/:sessionId/questions/:questionId/answer`           | Record or edit one documented answer.                          |
| `PATCH /api/clients/:clientId/sessions/:sessionId/opportunities/:opportunityId`         | Edit savings assumptions.                                      |
| `POST /api/clients/:clientId/sessions/:sessionId/opportunities/:opportunityId/proposal` | Regenerate/replace a proposal.                                 |
| `PATCH /api/clients/:clientId/sessions/:sessionId/opportunities/:opportunityId/plan`    | Edit plan sections; review status.                             |
| `GET /api/clients/:clientId/sessions/:sessionId/opportunities/:opportunityId/plan.md`   | Markdown export (blocked while stale).                         |

Errors use one envelope: `{ "error": { code, message, … } }` with codes
`invalid_input` (400), `not_found` (404), `stale_revision`/`stale_artifact`
(409), `fixture_unsupported`/`consent_required` (422), `provider_unconfigured`/
`storage_unavailable` (503), `internal_error` (500).

## Fixture scope and limits

- The fixture answers **only** for the seeded demo session
  (`cli_hotel_demo`/`ses_hotel_demo`), the unmodified seed transcript, and —
  after exactly the documented answer is recorded on `q_hotel_01` — its
  follow-up variant. Anything else (edited transcripts, second answers,
  different wording, unknown opportunities, unknown stages) is rejected with
  `fixture_unsupported`; the fixture never invents analysis for states it does
  not document.
- Evidence quotes are validated verbatim at module load and re-validated
  against persisted sources on every run. The follow-up outputs cite the
  **persisted answer id**, so they bind to whatever id the answer flow
  actually assigned.
- Savings figures are arithmetic on consultant-provided assumption inputs with
  cited bases; they are estimates, not measurements. Provenance validation
  establishes where a claim came from, not that it is factually true.
- Recorded-audio transcription is an optional, clearly-labeled alternative to
  pasted text (see its section above): the draft review step is mandatory, the
  app retains no audio or provider response, and consent precedes every
  upload. Retention on the provider side is governed by that provider's
  account settings, which this app neither controls nor claims to disable.

## Layout

```
server/demo/hotel.ts          fictional seed + canned fixture provider (this slice)
server/analysis/              discovery, proposals, staleness, markdown seams
server/audio/                 recorded-audio validation, transcription, drafts
server/api/, server/store/    Nitro routes and the JSON snapshot store
shared/p0/                    stage schemas, persisted schemas, wire contracts
shared/p1/                    recorded-audio contracts (allowlist, draft shape)
scripts/                      sample-audio maker + local transcription stub
tests/demo/                   fixture QA through the real seam (no build needed)
tests/smoke/                  end-to-end smoke against the built server
tests/ui/, tests/store/, …    coverage owned by the storage/workbench slices
```

## Verification status

`npm test` (build + unit + API + smoke), `npm run typecheck`, and `npm run lint`
all pass on the integrated tree as of this slice. Corrections without
verification persist as inferred consultant claims (string, list, and execution
fields, plus cleared values) and survive re-analysis; the smoke covers the
built-server slice, restart durability, the stale-export gate, and the
live-provider failure paths through a local stub. Live runs against real
external providers remain unverified (see the note above).
