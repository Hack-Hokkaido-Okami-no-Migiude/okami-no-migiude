# Shima Enaga — municipal self-hosting and pilot runbook notes (draft)

Owner-facing operating notes for self-hosting this P0 slice by Sapporo or a
designated municipal operator. **Draft for planning — not an implemented
runbook.** Sections marked **Provisional** describe behavior specified in
`SHIMA-PILOT-CONTRACT.md` and `SHIMA-PROVIDERS.md` that is **not implemented
at this commit (`f093386`)**; later integration finalizes the exact supported
commands and environment variables. No current affiliation, partnership,
endorsement, or government service exists or is implied; the project is
independent, and the demo business (Hotel Yuki Sapporo) is fictional.

## What is real today

- **Zero-key local demo (implemented).** `npm install`, `npm run build`,
  `npm start` serves on `127.0.0.1` (loopback-only by default via
  `scripts/start.mjs`; `NITRO_HOST`/`NITRO_PORT`/`NITRO_UNIX_SOCKET` exist for
  explicit operator choice, not for exposing a dev server). Data persists as a
  JSON snapshot under `NUXT_DATA_DIR` (default `.data/`, git-ignored).
- **Local seed.** `POST /api/demo/hotel` (idempotent) seeds the fictional
  twelve-person Hotel Yuki Sapporo interview (`cli_hotel_demo` /
  `ses_hotel_demo`). The fixture answers only the documented seed and the one
  documented follow-up answer on `q_hotel_01`; anything else is rejected with
  `fixture_unsupported` (422) — the fixture never invents analysis. A labeled
  fictional role-play (「ロールプレイ（架空・マイクなし）」 — no microphone, no live
  AI) is part of the in-flight tracer work. Demo booking, payment, and subsidy
  matching are mocks.
- **Demo ≠ real interview.** The demo path uses fixtures only; the fixture
  publish route is synthetic/loopback and must never be repurposed for real
  data. There is no real interview intake or publication path at this commit.

## Deployment topology (Provisional beyond loopback)

Specified target for a real deployment; not implemented at this commit:

- One Node process as the single writer; a dedicated restricted data volume
  with operator-managed backups; no shared storage with unrelated systems.
- A TLS-terminating reverse proxy in front of the app; exact configured
  `Host`/`Origin` checks; CSRF protection and `no-store` on private surfaces;
  request size/rate limits; no raw Nitro, dev-server, or preview build
  exposed.
- **Private ingress (authenticated):** the owner interview/map/package UI and
  its API. Distinct server principals for owner, named reviewer, admin, and
  engineer — owner and reviewer are different authenticated humans; engineers
  are provisioned outside the public board; a demo cookie never satisfies
  real access.
- **Public ingress allowlist (unauthenticated):** published quest board and
  static assets only — `GET /api/quests`, `GET /api/quests/:questId`,
  `POST /api/quests/:questId/claim` — with fixed, generic errors and no
  private routes, cookies, or joins. Every other public path returns a fixed
  `404`.
- Even on a one-business deployment, verify against a second synthetic
  business and non-member principals before any exposure.

## Modes and the real-pilot gate (Provisional)

Four modes are specified, not implemented. Until they exist, only the
fixture-local demo above is available: real intake may stay local, and
analysis is unavailable without authorization and configuration — fixture
analysis is never applied to real input.

| Mode | Scope |
| --- | --- |
| `fixture-local` | Synthetic, loopback, zero-key demo (what exists today). |
| `public-demo` | Separate deployment; no private routes, no providers. |
| `private-capture` | Real private intake; no board or release. |
| `real-pilot` | Isolated; publishing requires the gate below. |

**Gate (required for any real publication):** a server-side deployment enable
plus an authenticated admin permit bound to one business, one package, and
the current preview; a named-reviewer identifiability check; owner approval
of the same ID/hash with confirmation of the exact nonnegative integer yen.
Any change invalidates approvals and permit. Disabled routes return a fixed
`404`; no request toggle or demo cookie can authorize release. A passing
real-lane test on synthetic content is not authority to release.

## Environment practices, keys, and retention

- Copy `.env.example` to `.env`; never commit real values. Keys are read
  server-side only — never sent to the browser, logged, or persisted.
- **Current variables (verified behavior):** `NUXT_DATA_DIR`;
  `NUXT_LLM_BASE_URL` / `NUXT_LLM_API_KEY` / `NUXT_LLM_MODEL` (live analysis
  is off until all three are set, and each run additionally requires explicit
  consent `allowExternal: true`; otherwise it fails closed with
  `provider_unconfigured`, 503); `NUXT_ELEVENLABS_API_KEY` and
  `NUXT_ELEVENLABS_BASE_URL` for recorded-audio transcription (the base-URL
  override is accepted only for loopback test stubs; the fixed official host
  is used otherwise, and the base URL is never taken from request payloads).
- **Proposed for live voice (Provisional — names not yet read by the app):**
  `NUXT_ELEVENLABS_VOICE_ID_JA` / `NUXT_ELEVENLABS_VOICE_ID_EN`, or
  `NUXT_ELEVENLABS_AGENT_ID` for the deferred hosted-agent path.
- Key hygiene: project-scoped, least-privilege, rotatable; never log
  transcripts, provider URLs with credentials, or provider error bodies;
  redirects are rejected on every provider call so audio and keys cannot be
  relayed elsewhere; one transcription attempt per upload (no automatic paid
  retries).
- **Retention (app side):** the recorded-audio path stores no raw audio and
  no provider response; the durable store keeps transcripts, analysis, and
  package records under `NUXT_DATA_DIR`. Backups and their retention are the
  operator's responsibility on the restricted volume.
- **Retention (provider side):** documented vendor capabilities only (see
  `SHIMA-PROVIDERS.md`): zero-retention settings and log-off flags exist but
  require eligible account access and explicit configuration — they are not a
  guarantee; default vendor storage is US; ordinary deletion may leave
  debugging/moderation data, and deleted items can persist in backups for up
  to ~30 days. Local deletion and provider-side cleanup are reported
  separately; neither implies the other.
- Known correction in flight: the vendor-documented transcription-deletion
  path is `DELETE /v1/speech-to-text/transcripts/{transcription_id}`, while
  the current README shows an older path — verify the corrected route at
  integration rather than trusting this draft or the README.

## Real pilot prerequisites — written permission checklist (Provisional)

Before any real interview or publication, complete all of the following — in
writing where stated:

- [ ] Written authorization from the municipality/operator enabling the pilot
      mode on the deployment.
- [ ] Access agreement with the actual Hokkaido business (owner contact and
      system access provisioned).
- [ ] Individual consent from every participant, including a solo owner —
      recorded per person with notice version, purpose, actual provider, and
      server time; no blanket owner checkbox; each participant can stop or
      revoke their own purpose.
- [ ] Distinct authenticated owner, named reviewer, admin, and engineer
      principals, with reviewer and owner as different people.
- [ ] Reviewed host security: TLS, exact `Host`/`Origin` checks, isolation,
      restricted volume/backups, size/rate limits — plus the second synthetic
      business and non-member verification pass.
- [ ] Admin permit bound to one business/package/current preview; owner
      approval of the exact ID/hash; any change invalidates both.
- [ ] Separate written permission before using any real quote or screenshot
      in a pitch or other public material.

Missing any item means **no real interview and no publication** — the
fixture demo remains the only usable surface.

## Verification status

No live or pilot provider calls were made for these notes. Vendor behaviors
cited here are documented capabilities from `SHIMA-PROVIDERS.md`, not
exercised in this work. Live-provider analysis, recorded transcription
against the live API, live voice, and all gated modes remain unverified.
Gate before trusting any of it: `npm test`, `npm run typecheck`, and
`npm run lint` on the integrated tree (parent-owned verification).
