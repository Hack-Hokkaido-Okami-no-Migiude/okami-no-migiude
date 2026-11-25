# Okami no Migiude (女将の右腕) — MVP Build Contract

Status: **Approved for the first executable slice**, with the following decisions
taking precedence over the discovery details below.

- Business type values: `accommodation`, `food_service`, `retail`, `tourism`,
  `agriculture`, `manufacturing`, `construction`, `transport`, `healthcare`,
  `professional_services`, `other`. The signup dropdown supplies the full labels
  from the brief. `SessionUser` is a discriminated union by role.
- One submitted interview/report per owner. Completion and consultation are
  idempotent; repeat calls return the existing result. Other owners receive 404
  for detail, download and consultation. Staff cannot request consultation.
  Expose `mode` on `InterviewCurrent`. Deadline is enforced by server wall clock;
  the browser stops capture by the deadline, rejects late callbacks, and never
  sends a fabricated completion if capture is empty.
- The first slice uses SQLite with durable pending report state and a periodic
  worker. An outbox with unique `(report, audience, recipient)` keys is enough;
  a separate generic jobs table is not required. Write owner and staff messages
  and mark ready transactionally. Local delivery uses one stable `.eml` filename
  per message. Report summary/detail and attachment stay private and non-cacheable.
- Email link returns to `/reports/:id` after sign-in. The owner receives one
  report-ready message; every designated staff recipient gets a separate message
  with the same protected report link. Consultation is visible in the staff queue.
  First slice has local file delivery only. A later configurable mail adapter may
  use an idempotent provider API instead of SMTP.
- Errors use H3 `data.error`, never upstream errors or transcript excerpts.
  Use session-token hashes at rest and enforce same-origin browser writes. Keep
  demo credentials configurable and never checked in. Default loopback/demo only;
  review deployment hardening before using real business data.
- Report `content` remains Markdown in the initial slice. For richer output,
  keep the existing API stable and add optional structured fields only with lead
  approval. Do not render unsanitized Markdown as HTML.
- Live mode stays unavailable until an explicit browser/provider handoff is
  implemented and configured. The example `/analyses` call below is not an
  interview protocol and must not be implemented or presented as one. Use a
  labeled scripted demo, optionally with actual browser voice as a local test
  substitute, and keep analysis labels accurate. No outbound transcript or
  audio transfer to an unconfirmed endpoint.
  This file is the single shared contract for the MVP build. It defines the product
  scope, exact types, the API wire contract, the durable queue, the mail outbox,
  and the two explicitly provisional seams (teammate integration, demo substitutes).

Change control: any change to §4 (types), §5 (endpoints), or §10 (integration
boundary) requires lead sign-off before code changes.

Recorded 2026-11-25 (grounding pass): commit fa926bb removed business type from
signup intake. The form collects name, email, business name and municipality
plus optional phone, website, note and a profile-language choice, and the
server still accepts a `businessType` value for older clients, defaulting it to
`other` (`server/utils/signup.ts`). The shipped slice also differs from §9, §10
and §15 as follows: SMTP is intentionally not implemented (the local `.eml`
outbox is the default, with an optional Resend REST adapter behind
`MAIL_LIVE_PROVIDER`), live interview mode is rejected unconditionally with
`409 mode_unavailable` because the teammate integration is not connected, and a
separate credentials-gated ElevenLabs voice chat (conversation only) exists
under `/voice`; `.env.example` carries the corresponding variables.

---

## 1. Scaffold audit — verified facts this contract builds on

Repo audited at commit `ac7c8eb` (branch `main`, working tree clean). Versions
verified from the installed tree: Nuxt **4.7.0**, Nitro **2.14.0**, Node
**v26.13.1**, npm **11.20.0**.

What exists:

- Nuxt 4 app shell (`app/`, layouts, `AppHead`/`AppProviders`), single index page.
- `shared/types/` is the established home for cross-boundary types; the `#shared`
  alias resolves in **both** `.nuxt/tsconfig.app.json` and
  `.nuxt/tsconfig.server.json` (verified). Existing files: `json.ts`,
  `unknown.ts`, `utilities.ts`.
- Runtime body-validation utilities already exist in `shared/types/unknown.ts`:
  `assertUnknownMatchesSchema`, `assertUnknownHasProperties`,
  `unknownHasProperty`, plus `PropertyTypeError`. These validate JSON shapes by
  `typeof` (nested objects included). They do **not** validate unions, array
  element types, string formats, or lengths — add small hand-written guards for
  those; do not add a schema/validation library for MVP.
- UI stack: Bootstrap **5.3.8** CSS (CDN `@import` in `app/styles/global.scss`),
  Material Symbols Outlined icons, Inter font, dark mode via
  `@nuxtjs/color-mode` (`data-bs-theme` attribute, `fallback: 'dark'`).
- Tooling: ESLint flat config (`@nuxt/eslint` + `@eslint/js` recommended +
  `eslint-config-prettier`; `curly`, `prefer-arrow-callback`, `prefer-const`,
  `sort-imports`), Prettier (tabs, width 4, printWidth 80, singleQuote, semis,
  `proseWrap: preserve`). LF endings, final newline enforced in editor settings.
- Env handling: `dotenvx` in dev, `node --env-file-if-exists=.env` in
  production; `.env` is gitignored with `!.env.example` already allowed — commit
  a `.env.example` at implementation time.

What does **not** exist yet (all greenfield below): no `server/` routes, no
database, no auth, no mail, no queue, no tests, no `docs/` other than this file.

---

## 2. Product scope (MVP)

One Nuxt full-stack app (Nitro server) running as a **single process, single
instance**. Audience is municipal small/medium-business (SMB) support.

- **Roles** (exactly two): `owner` — self-registered SMB operator; `staff` —
  designated accounts configured server-side (§7). No other roles.
- **Locales**: Japanese (`ja`, default) and English (`en`). Every owner-facing
  string exists in both. No i18n framework for MVP — a small locale dictionary
  keyed by `Locale` in app code.
- **Features**:
    1. Sign-up / sign-in with email + password.
    2. Owner profile with exactly the fields in §4.
    3. Interview: explicit consent gate, transcript submit; conversation length is managed by the agent, with no hard time limit or visible timer.
    4. Asynchronous report generation from the transcript; visible to the
       owner who owns it and to staff.
    5. Report-ready notification mail to the owner (§9).
    6. Consultation request on a ready report (timestamp only in MVP).
    7. Staff list of all reports across owners.
- **Explicit substitutes** (§11): demo interviews are fictional and visibly
  labeled; demo analysis is rule-based, not AI.
- **Explicit boundary** (§10): the teammate's live agent/research service is
  **not confirmed to exist or interoperate**; this contract defines only a
  provisional authenticated seam, never a claimed interop.

Non-goals are listed in §13.

---

## 3. Wire format rules (apply to every endpoint)

- Base path `/api`; JSON bodies and responses, UTF-8, `Content-Type:
application/json` (except the download endpoint).
- IDs: UUID v4 strings generated server-side.
- Timestamps: ISO 8601 UTC with milliseconds and `Z`
  (e.g. `2026-11-25T09:00:00.000Z`). Stored as the same text in the DB — one
  format everywhere.
- Request optional fields may be omitted; stored profile fields normalize
  omission to `null`.
- Unknown extra properties in requests are ignored, not rejected.

---

## 4. Exact domain types

Lives in `shared/types/domain.ts` (new file), imported via `#shared/types/domain`
from both app and server.

```ts
export type Locale = 'ja' | 'en';

export type UserRole = 'owner' | 'staff';

export type BusinessType =
	| 'food_service'
	| 'retail'
	| 'accommodation'
	| 'service'
	| 'manufacturing'
	| 'other';

export type OwnerProfile = {
	name: string;
	email: string; // account email; set server-side at signup, never edited in MVP
	businessName: string;
	businessType: BusinessType;
	otherBusinessType: string | null; // required when businessType is 'other'
	municipality: string;
	phone: string | null;
	website: string | null;
	note: string | null;
	locale: Locale;
};

export type StaffProfile = {
	name: string; // defaults to the email local part at provisioning
	email: string;
};

export type SessionUser = {
	id: string;
	role: UserRole;
	profile: OwnerProfile | StaffProfile;
};

export type InterviewMode = 'demo' | 'live';

export type InterviewStatus = 'active' | 'submitted';

/** Shape exposed by GET /api/interviews/current. */
export type InterviewCurrent = {
	id: string;
	status: InterviewStatus;
	deadlineAt: string; // ISO 8601 UTC
};

/** Full interview row (server-side; never returned whole by the API). */
export type Interview = {
	id: string;
	ownerId: string;
	mode: InterviewMode;
	status: InterviewStatus;
	consentAt: string; // equals startedAt in MVP
	startedAt: string;
	deadlineAt: string; // startedAt + 1 hour
	submittedAt: string | null;
	transcript: string | null;
};

export type ReportStatus = 'pending' | 'ready' | 'failed';

export type Report = {
	id: string;
	interviewId: string;
	ownerId: string;
	businessName: string; // snapshot of the owner profile at submit time
	locale: Locale; // snapshot of the owner profile at submit time
	status: ReportStatus;
	content: string | null; // Markdown; null while pending/failed
	failureReason: string | null; // set only when status is 'failed'
	consultationRequestedAt: string | null;
	createdAt: string;
	readyAt: string | null;
};

/** Shape returned by GET /api/staff/reports. */
export type StaffReportSummary = {
	id: string;
	ownerId: string;
	ownerName: string;
	ownerEmail: string;
	businessName: string;
	locale: Locale;
	status: ReportStatus;
	consultationRequestedAt: string | null;
	createdAt: string;
};
```

API payload types live in `shared/types/api.ts` (new file):

```ts
export type SignupRequest = {
	email: string;
	password: string;
	profile: {
		name: string;
		businessName: string;
		businessType: BusinessType;
		otherBusinessType?: string; // required iff businessType === 'other'
		municipality: string;
		phone?: string;
		website?: string;
		note?: string;
		locale: Locale;
	};
};

export type LoginRequest = { email: string; password: string };

export type SessionResponse = { user: SessionUser | null };

export type InterviewStartRequest = { consent: true; mode: InterviewMode };

export type InterviewStartResponse = { interview: InterviewCurrent };

export type InterviewCompleteRequest = { transcript: string };

export type InterviewCompleteResponse = {
	interview: InterviewCurrent;
	reportId: string;
};

export type InterviewsCurrentResponse = {
	interview: InterviewCurrent | null;
	reportId: string | null;
};

export type ReportResponse = { report: Report };

export type StaffReportsResponse = { reports: StaffReportSummary[] };
```

---

## 5. API contract

All endpoints enforce the auth column. "own" = the authenticated owner may act
only on resources whose `ownerId` matches their session user id.

| Method | Path                            | Auth                   | Success                             |
| ------ | ------------------------------- | ---------------------- | ----------------------------------- |
| POST   | `/api/auth/signup`              | none                   | 201 `{ user: SessionUser }`         |
| POST   | `/api/auth/login`               | none                   | 200 `{ user: SessionUser }`         |
| POST   | `/api/auth/logout`              | session (any role)     | 200 `{ user: null }`                |
| GET    | `/api/auth/session`             | none (cookie optional) | 200 `{ user: SessionUser \| null }` |
| GET    | `/api/interviews/current`       | owner                  | 200 `{ interview, reportId }`       |
| POST   | `/api/interviews/start`         | owner                  | 201 `{ interview }`                 |
| POST   | `/api/interviews/:id/complete`  | owner (own)            | 200 `{ interview, reportId }`       |
| GET    | `/api/reports/:id`              | owner (own) or staff   | 200 `{ report }`                    |
| GET    | `/api/reports/:id/download`     | owner (own) or staff   | 200 `text/markdown`                 |
| POST   | `/api/reports/:id/consultation` | owner (own)            | 200 `{ report }`                    |
| GET    | `/api/staff/reports`            | staff                  | 200 `{ reports }`                   |

### POST /api/auth/signup

- Body: `SignupRequest`.
- Rules: email trimmed + lowercased and must match a simple email pattern
  (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`); password at least 8 characters;
  `otherBusinessType` must be a non-empty string iff `businessType === 'other'`;
  `profile.locale` must be `'ja' | 'en'`. A staff-listed email (§7) is reserved
  and cannot be used for signup.
- Effects: creates the owner user + profile, starts a session (sets cookie).
- `profile.email` is not part of the request; the server stores the account
  email there.
- Errors: 400 `validation`; 409 `email_taken`.

### POST /api/auth/login

- Body: `LoginRequest`. Errors are identical whether the email or the password
  is wrong (no account enumeration).
- Errors: 401 `invalid_credentials`.

### POST /api/auth/logout

- No body. Deletes the current session row and clears the cookie.
- Always 200 (idempotent), even without a valid session.

### GET /api/auth/session

- No valid cookie → 200 `{ user: null }` (not an error), so the client can
  render the signed-out state without error handling.

### GET /api/interviews/current

- Owner only. "Current" is the owner's interview that is submitted, or active
  and not yet expired.
- An active interview whose `deadlineAt` has passed is treated as **closed**:
  the response is `{ interview: null, reportId: null }` and a new interview may
  be started. (The two exposed statuses stay exactly `active | submitted`;
  expiry is derived from `deadlineAt`.)
- `reportId` is non-null only when the returned interview is submitted (the
  report row is created synchronously at submit time; its _generation_ is
  async).

### POST /api/interviews/start

- Body: `InterviewStartRequest`. `consent` must be exactly the boolean `true`
  (this is the recorded interview consent); anything else → 400.
- Effects: creates the owner's interview: `status: 'active'`, `startedAt = now`,
  `deadlineAt = startedAt + 1 hour` (constant; §14), `consentAt = startedAt`,
  `mode` as requested.
- Errors: 400 `validation`; 403 `forbidden` (staff); 409 `interview_active`
  (an unexpired active interview already exists); 409 `mode_unavailable`
  (`mode: 'live'` requested but the integration is not configured, §10).

### POST /api/interviews/:id/complete

- Body: `InterviewCompleteRequest`; `transcript` must be a non-empty string of
  at most 200,000 characters after trimming.
- Rules: the interview must belong to the caller, be `active`, and not past
  `deadlineAt`.
- Effects: sets `submittedAt` and `status: 'submitted'`; inserts the `Report`
  row (`status: 'pending'`, `businessName`/`locale` snapshotted from the owner
  profile); enqueues the `generate_report` job (§8).
- Errors: 400 `validation`; 403 `forbidden`; 404 `not_found`; 409
  `already_submitted`; 409 `interview_expired`.

### GET /api/reports/:id

- Owner (own report) or any staff.
- `content` is non-null only when `status: 'ready'`; `failureReason` is
  non-null only when `status: 'failed'`.
- Errors: 401 `unauthorized`; 403 `forbidden`; 404 `not_found`.

### GET /api/reports/:id/download

- Same authorization as above.
- Response: `Content-Type: text/markdown; charset=utf-8`,
  `Content-Disposition: attachment; filename="report-<id>.md"`.
- Errors: 409 `not_ready` when status is `pending` or `failed`; otherwise as
  above.

### POST /api/reports/:id/consultation

- Owner only, own report. No request body.
- Effects: sets `consultationRequestedAt = now` (once; MVP records the request
  only — no booking, no staff notification).
- Errors: 403 `forbidden`; 404 `not_found`; 409 `not_ready` (report not
  `ready`); 409 `already_requested`.

### GET /api/staff/reports

- Staff only. Returns all reports, newest first by `createdAt`. No pagination
  in MVP (dataset expected small; add a limit later if needed).
- Staff open a full report via `GET /api/reports/:id` / `/download`, which
  accept staff access by design.

---

## 6. Error envelope

Every non-2xx JSON response body is:

```json
{ "error": "<machine_code>", "message": "<optional human-readable message>" }
```

| Code                  | HTTP | Meaning                                                     |
| --------------------- | ---- | ----------------------------------------------------------- |
| `validation`          | 400  | Body/params failed schema or value checks                   |
| `unauthorized`        | 401  | No valid session where one is required                      |
| `invalid_credentials` | 401  | Login email/password mismatch                               |
| `forbidden`           | 403  | Wrong role or not the resource owner                        |
| `not_found`           | 404  | Unknown resource id (does not leak existence across owners) |
| `email_taken`         | 409  | Signup email already registered or staff-reserved           |
| `interview_active`    | 409  | An unexpired active interview already exists                |
| `interview_expired`   | 409  | Interview past its deadline                                 |
| `already_submitted`   | 409  | Interview already completed                                 |
| `mode_unavailable`    | 409  | `live` requested but integration not configured             |
| `not_ready`           | 409  | Report not `ready` (download/consultation)                  |
| `already_requested`   | 409  | Consultation already requested                              |
| `internal`            | 500  | Unexpected server error (logged server-side)                |

Implementation: h3 `createError({ statusCode, data: { error, message } })`.
Nuxt's default 404 for unknown routes is outside this envelope.

---

## 7. Auth & sessions

- **Passwords**: hash with Node's built-in `crypto.scrypt` (per-user random
  16-byte salt, default scrypt parameters). Stored as
  `scrypt$<salt-hex>$<hash-hex>`. No native or third-party crypto dependency.
- **Sessions**: opaque 32-byte random token (base64url) in a single cookie
  `session` — `HttpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS,
  `Path=/`. Fixed 30-day expiry from login (not rolling). Sessions are stored
  server-side (DB table `sessions`); the cookie carries only the token.
  `POST /api/auth/logout` deletes the row and clears the cookie.
- **Staff provisioning**: `STAFF_EMAILS` (comma-separated) designates staff.
  At server boot, every listed email without a user row is upserted as a staff
  user (name = email local part) with password hash from `STAFF_PASSWORD`
  (shared initial password). Staff accounts cannot be created via signup;
  signup with a staff-listed email → 409 `email_taken`. Password change flows
  are out of scope for MVP.
- **Login rate limiting**: none in MVP (noted as a hardening item, not a
  contract blocker).

---

## 8. Durable queue — single process

- **Runtime**: the Nitro server is one Node process (`npm start` →
  `.output/server/index.mjs`). The queue is in-process; there is no external
  broker and no second process.
- **Storage**: SQLite via `node:sqlite` (built into Node 26 — verified
  v26.13.1; **zero new dependencies**). DB file `${DATA_DIR}/app.db` (default
  `.data/`, already gitignored), `journal_mode = WAL`, `foreign_keys = ON`.
- **`jobs` table**: `id`, `type` (`'generate_report' | 'send_mail'`),
  `payload_key` (report id or mail id; `UNIQUE(type, payload_key)` makes
  double-enqueue a no-op via `INSERT OR IGNORE`), `payload` (JSON text),
  `status` (`'queued' | 'running' | 'done' | 'failed'`), `attempts`,
  `max_attempts` (default 5), `run_after` (epoch ms), `last_error`,
  `created_at`, `updated_at`.
- **Worker**: a single loop inside the server process — 1 s idle poll; one job
  at a time; continues immediately when another job is due.
- **Claim**: `BEGIN IMMEDIATE; UPDATE jobs SET status='running' ... WHERE id =
(SELECT id FROM jobs WHERE status='queued' AND run_after <= :now ORDER BY
run_after LIMIT 1) RETURNING ...; COMMIT`. Safe by construction — exactly one
  worker exists.
- **Crash recovery (the durability story)**: on boot, before serving traffic:
  (1) reset orphaned work — `UPDATE jobs SET status='queued' WHERE
status='running'`; (2) reconcile — any report still `pending` whose
  `generate_report` job is not `queued`/`running` gets re-enqueued.
- **Retry**: on failure `attempts += 1` and
  `run_after = now + 2^attempts × 30 s`; after `max_attempts` the job becomes
  `failed` with `last_error` kept.
- **Handlers**:
    - `generate_report {reportId}` — demo mode: rule-based analyzer (§11, pure
      function over transcript + profile snapshot; no network). Live mode: the
      §10 adapter with a 30 s timeout. Success: report → `ready` with `content`
      and `readyAt`, then enqueue the report-ready mail (§9). Final failure:
      report → `failed` with `failureReason` set from the last error.
    - `send_mail {mailId}` — hands the pre-composed mail to the configured
      provider (§9).
- Graceful drain on shutdown is not required for MVP; boot recovery covers
  restarts.

---

## 9. Mail outbox — local substitute + Resend live provider

- **`mail_outbox` table**: `id`, `to_address`, `subject`, `body`,
  `provider` (`'local' | 'resend'`), `status` (`'queued' | 'sent' | 'failed'`),
  `attempts`, `last_error`, `created_at`, `sent_at`, `related_type`,
  `related_id`.
- **Compose at enqueue time**: the report-ready mail is fully rendered when the
  report becomes ready — recipient = owner profile email, subject and body in
  the owner's `locale`, body contains the absolute link
  `${PUBLIC_BASE_URL}/reports/<reportId>`. Providers stay dumb senders.
- **Providers** (selected per attempt from env; no code change to switch):
    - `resend` (**the only live provider**): active iff `MAIL_RESEND_API_KEY`
      is set (with `MAIL_FROM` as the sender). Idempotent REST delivery with no
      new dependencies; stable Idempotency-Key per message, so retries never
      double-send. A send failure returns the job to the queue for retry
      (§8 backoff).
    - `local` (**default without a key**): writes an RFC 5322-ish `.eml` file to
      `${DATA_DIR}/mail-outbox/<mailId>.eml`, then marks the row `sent`. No
      network access. This is the local substitute for the live provider.
- A mail failure never changes the report status; the report is already `ready`.

---

## 10. Integration boundary — PROVISIONAL (teammate live agent/research)

> The teammate's live agent/research contract is **not supplied**. Nothing in
> this section implies confirmed interoperability. Endpoint names and payloads
> below are **placeholders** to be reshaped when the real contract arrives.

- **Seam**: every external agent call lives in one server-side module
  (`server/integration/`). No page, API route, or queue handler may touch the
  integration except through this adapter. When the teammate's real contract
  lands, only this module (plus env names) changes — the §5 API surface does
  not move.
- **Transport + auth (provisional)**: HTTPS `POST` to `INTEGRATION_BASE_URL`
  with header `Authorization: Bearer ${INTEGRATION_TOKEN}`. Both values are
  server env only: never shipped to the browser, never logged, never embedded
  in client bundles.
- **Provisional call (UNVERIFIED placeholder)**: `POST
${INTEGRATION_BASE_URL}/analyses` with body
  `{ transcript, locale, business: { businessName, businessType, municipality } }`,
  expecting `200 { content: string }`. Non-2xx status, a 30 s timeout, or a
  response-shape mismatch is treated as a **retryable failure** (§8 retry
  semantics; final failure → report `failed`).
- **Gating**: live mode is enabled iff both `INTEGRATION_BASE_URL` and
  `INTEGRATION_TOKEN` are set. Otherwise `POST /api/interviews/start` with
  `mode: 'live'` → 409 `mode_unavailable`, and the UI never offers live mode.
- Until the real contract exists, the only _verified_ behaviors of this
  boundary are the failure path (timeouts/errors handled) and the demo path
  (§11) — both must work with the integration switched off.

---

## 11. Demo substitutes — visibly labeled

- **Fictional interview (`mode: 'demo'`)**: the interview UI runs a scripted,
  fictional interviewee (fixed persona and Q&A flow) shipped as static app
  data — no server endpoint is needed for the script. The UI displays a
  persistent, visible label: JP 「サンプル面談（フィクション）」 / EN
  “Sample interview (fictional)”. The submitted transcript is the scripted
  dialogue; it is stored and processed like any transcript.
- **Rule-based analysis**: demo report generation is a deterministic
  keyword/section rule engine over the transcript + owner profile snapshot —
  no network, no AI, same output for the same input. The report view labels
  the output: JP 「自動下書き（ルールベース）」 / EN “Automated draft
  (rule-based)”.
- Both labels are contract requirements: the exact copy may be polished during
  UI implementation, but visible labeling must remain in the shipped UI.
- All demo content is fictional; any resemblance to real businesses is not
  intended.

---

## 12. Storage outline

Single SQLite DB (via `node:sqlite`) at `${DATA_DIR}/app.db`. Timestamps are
ISO 8601 UTC text (same as the wire format).

- `users`: `id`, `email` UNIQUE, `password_hash`, `role`, `created_at`
- `owner_profiles`: `user_id` PK → `users`, `name`, `business_name`,
  `business_type`, `other_business_type`, `municipality`, `phone`, `website`,
  `note`, `locale`
- `sessions`: `token` PK, `user_id` → `users`, `expires_at`, `created_at`
- `interviews`: `id`, `owner_id` → `users`, `mode`, `status`, `consent_at`,
  `started_at`, `deadline_at`, `submitted_at`, `transcript`, `created_at`
- `reports`: `id`, `interview_id` UNIQUE → `interviews`, `owner_id`,
  `business_name`, `locale`, `status`, `content`, `failure_reason`,
  `consultation_requested_at`, `created_at`, `ready_at`
- `jobs`, `mail_outbox`: as specified in §8 / §9

---

## 13. Non-goals (MVP)

Password reset; email verification; OAuth/SSO; per-municipality tenancy
isolation beyond the staff email list; staff management UI; consultation
booking or scheduling (timestamp only); report editing; file uploads;
pagination; an i18n framework (locale dictionaries instead); horizontal
scaling / multi-instance deployment; cron; websockets; analytics. Automated
tests are not fixed by this contract — adopt (e.g. Vitest) at implementation
if the team chooses.

---

## 14. Approval checklist (lead signs off before implementation)

- [ ] §4 `BusinessType` enum values
- [ ] §5 signup rules: password ≥ 8 chars; `otherBusinessType` required iff
      `businessType === 'other'`; staff emails reserved
- [ ] §5 interview rules: one unexpired active interview per owner; 1-hour
      window; expiry closes the interview (current → null, restart allowed)
- [ ] §5 consultation is timestamp-only (no booking, no staff notification)
- [ ] §5 download format: `text/markdown` attachment
- [ ] §7 staff provisioning via `STAFF_EMAILS` + `STAFF_PASSWORD`
- [ ] §7 session TTL 30 days (fixed), cookie policy
- [ ] §8 SQLite via `node:sqlite`; retry backoff `2^n × 30 s`; max 5 attempts
- [ ] §9 default mail provider = local `.eml` outbox; Resend is the only live sender
- [ ] §10 provisional integration shape accepted as a placeholder until the
      teammate's contract is supplied
- [ ] §11 demo labeling wording (JP/EN)

## 15. Environment variables (committed as `.env.example` at implementation)

```
DATA_DIR=.data
PUBLIC_BASE_URL=http://localhost:3000
STAFF_EMAILS=          # comma-separated; enables staff accounts
STAFF_PASSWORD=        # shared initial staff password
MAIL_FROM=             # sender address for all mail (Resend and the local outbox)
MAIL_RESEND_API_KEY=   # presence enables Resend, the only live email service
INTEGRATION_BASE_URL=  # absence disables live mode (demo only)
INTEGRATION_TOKEN=
```

## 16. Implementation "done" checks

- `npm run build` succeeds; `npx eslint .` and `npx prettier --check .` clean.
- Every §5 endpoint exists and enforces its auth column; a signed-out request
  to a protected route returns the §6 envelope.
- Queue durability: kill the server mid-report-generation and restart — boot
  reconciliation flips orphan jobs and the report still completes.
- Mail: with no `SMTP_*` env, completing an interview produces a readable
  `.eml` in `.data/mail-outbox/` containing the owner-locale subject and the
  report link.
- Live mode is unreachable while `INTEGRATION_*` is unset; demo labeling from
  §11 is visible in the UI.
