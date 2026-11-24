# Shima Enaga — Hear. Map. Match.

**Approved implementation contract.** Add to the existing Nuxt app, not a second analysis pipeline. `CONTRACT.md` still governs code quality, evidence, preservation, and delegation. Base: clean `main` at `a840e5115aa5afe85eb873c893b77359bb394a46` (recorded-audio Scribe support); no repo/ancestor `AGENTS.md` or `CLAUDE.md` found. Start with one small, test-first persistent fixture slice, then assign disjoint work and independently verify the merge.

**Tracer scope and non-negotiables.** First deliver fixture-only, loopback-only `Hear → Map → Match`, one catalog task, exact preview/yen approval, separate public DTOs, single-winner durable claim and restart. Do not enable network public mode or real interview capture in this slice. Full effort editing, package decline/edit/rebase and private consent/mode guards may follow the tracer. Keep fixture/private transcripts separate from public DTO fields and values even in the tracer. Guard destructive invalidation in the repository, and do not introduce a second writer. Do not copy private free text into public output, even if submitted as an anonymized preview. The final live transport choice is Scribe v3 Live + ElevenLabs TTS, with app-owned turn/question state, under the separate private-capture boundary; see `SHIMA-PROVIDERS.md`. Missing credentials do not block implementing and stub-verifying consent, local turn handling, and the explicit role-play path. Correct the existing batch deletion API path as its own scoped fix. The maintainer identity for the MIT notice is the repository's public Git author handle, `minimusubi` (do not invent an entity or publish an email).

## Reuse and first slice

| Existing paths                                                                                                                                                                                                                                                                                         | Decision                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/pages/index.vue`, `app/composables/useWorkbench.ts`, `app/components/workbench/{TranscriptPane,RecordedAudioUpload,FollowUpPanel,WorkflowReview,OpportunitiesPanel,PlanEditor}.vue`                                                                                                               | Keep the reviewer workbench and detailed evidence/graph. Add a Japanese-first owner flow at `/shima` and a minimal engineer board at `/quests`; use the existing paste/review/save path, scenario IDs and wire types. English is optional where feasible. |
| `server/api/clients/[clientId]/sessions/[sessionId]/{transcript.put,analyze.post,transcribe.post}.ts`, `questions/[questionId]/answer.put.ts`, `opportunities/[opportunityId]/{proposal.post,plan.patch}.ts` (under the same session directory); `server/store/{transcript,commit-session,cascade}.ts` | Reuse scoped persisted transcript/answer, CAS, citation cascade and proposals, not copies as Shima inputs. The recorded upload is batch Scribe → **unpersisted** draft → reviewed transcript PUT. It is not a live interview or saved consent.            |
| `server/analysis/{index,keys,staleness}.ts`; `shared/p0/{schemas,types,api,stages}.ts`                                                                                                                                                                                                                 | Reuse staged discovery, assessment, reconciliation, proposal, evidence refs and run fingerprints. Do not infer an edge from co-occurrence. Add Shima contracts alongside, not loosen P0. Existing plans marked `approved` never publish.                  |
| `server/api/demo/hotel.post.ts`, `server/demo/{hotel,hotel-payloads}.ts`; `tests/demo/hotel-fixture.test.ts`, `tests/smoke/{p0-slice,p0-live,p1-audio,local-binding}.test.ts`; `scripts/{dev-audio-stub,make-sample-audio,start}.mjs`                                                                  | Keep the recognized fictional seed and actual persisted answer binding; reuse the tested Node launch and local stubs. No credentials for the slice; distinguish recorded-audio stubs from live voice.                                                     |

**Tracer:** open Hotel Yuki fixture → analyze → ask existing `q_hotel_01` → save the documented fictional answer → analyze → show manual effort for the reconciled room-change step and `opp_hotel_02` → run its existing proposal → create one task package → prepare one safe preview → explicitly confirm its exact yen amount and approve → see it on `/quests` → claim it → reload and restart without reseeding. Cheap map source: the persisted follow-up says roughly 10 changes/week in high season at roughly 15 minutes each (about 150 minutes/week spent, owner-reported in the role-play); the current `10 hours/month` is a **potential upper estimate** assuming four such weeks and the full task time avoided, not measured savings. Keep season and residual work visible; do not fill unsupported weekly baselines. First pass may use a private, validated fixture projection for this one datum and reuse the plan for package defaults; no new provider, migration dependency, graph editor, or live UI prerequisite. Show `Fictional fixture / role-play — not a real interview`; no implicit fallback on provider errors.

## Private shapes, evidence and writes

Proposed new paths: strict Zod schemas/inferred TS under `shared/shima/{schemas,api,interview}.ts`. IDs and timestamps are server-issued (`pkg_`, `prv_`, `qst_`, `asg_` + opaque IDs; ISO instants server-side, calendar dates `YYYY-MM-DD`); use safe positive integer revisions, finite nonnegative quantities and whole safe nonnegative integer yen (`0` is valid; no textual/floating currency). Bounded fields/arrays; strict unknown-key rejection at each nesting level; use `null` for unknowns. Render text as text. These types are additive:

```ts
type Quantity =
	| { kind: 'unknown'; value: null; basis: null; evidence: [] }
	| {
			kind: 'owner-reported';
			value: number;
			basis: string;
			evidence: [EvidenceRef, ...EvidenceRef[]];
	  }
	| {
			kind: 'assumption';
			value: number;
			basis: string;
			evidence: EvidenceRef[];
	  };
type ManualEffortInput = {
	weeklyOccurrences: Quantity;
	minutesPerOccurrence: Quantity;
};
type ManualEffort = ManualEffortInput & {
	stepId: Id;
	minutesSpentPerWeek: number | null;
};
type OwnerMap = {
	rev: number;
	stale: boolean;
	manualEffort: ManualEffort[];
	gaps: { questionId: Id; prompt: string }[];
	opportunities: {
		opportunityId: Id;
		evidence: EvidenceRef[];
		estimatedHoursSavedPerMonth: number | null;
	}[];
};
type TaskDraft = {
	title: string;
	problem: string;
	proposedChange: string;
	deliverables: string[];
	acceptanceCriteria: string[];
	skills: string[];
	integrations: string[];
	benefits: string[];
	prerequisites: string[];
	limitations: string[];
	proposedBudgetYen: number | null;
	targetDate: string | null;
};
type OwnerAuthor = { actorId: Id; role: 'demo-owner' | 'local-owner' };
type OwnerDecision =
	| {
			kind: 'declined';
			author: OwnerAuthor;
			at: string;
			decidedAtRev: number;
	  }
	| {
			kind: 'approved';
			author: OwnerAuthor;
			at: string;
			decidedAtRev: number;
			confirmedBudgetYen: number;
			previewHash: string | null;
	  };
type TaskPackage = {
	id: Id;
	opportunityId: Id;
	draft: TaskDraft;
	basisKey: string;
	evidence: EvidenceRef[];
	state: 'draft' | 'declined' | 'approved' | 'published';
	stale: boolean;
	decision: OwnerDecision | null;
	previewId: Id | null;
	questId: Id | null;
};
```

- Weekly spent is `weeklyOccurrences × minutesPerOccurrence` on the same task/time scope; separate from future monthly savings calculated by P0 assumptions. Unknown is not zero. Show basis, season, and reported vs assumed vs unknown; no cross-period unit conversion without a labeled basis and no double-counted totals. Owner-reported requires wording supporting both scope and value (approximate reports stay approximate); assumptions are editable with a reason, never facts or promises. No AI justification by default if simplification or rules are sufficient. Validate each quote against active same-session `{sourceId,sourceRev,quote}` and validate support for the value/recommendation; unsupported values stay unknown or explicitly editable assumptions. The `OwnerMap` is a view over committed discovery plus sparse effort inputs, not a second graph.
- One draft per opportunity in this slice. Build from the current opportunity and existing proposal; owner can edit fields independently. Target date or cost is unknown unless specified; proposed yen is always an estimate. Use a server SHA-256 basis of discovery/proposal generation keys and the canonical relevant opportunity, current plan and evidence revision links, not aggregate `rev` or timestamps. Reject create/preview/approval on stale discovery, stale/missing proposal or mismatched/missing basis. Any draft edit invalidates its preview and unpublished decision. On basis drift, keep safe private edits for explicit rebase; purge affected private derivatives instead if a cited source is removed/revised (purge conservatively if free text may contain that source). `generate` with the same current basis is a no-op; rebase preserves surviving owner overrides, never silently re-approves. Published fixture task content is immutable; no in-place edits, reapproval or duplicate listing in P0. Transcript deletion atomically purges linked Shima effort, drafts, previews, receipts, quests and assignments; the existing P0 delete cascade still applies. Leave unrelated records untouched.

`S = /api/clients/:clientId/sessions/:sessionId`, `K = S/shima/packages`, `P = K/:packageId`. Private reads require the protected owner/reviewer surface; owner-only decisions derive author from server context, never a body `role`, person name or approval identity. Legacy P0 endpoints retain wire shapes. Proposed new routes under the corresponding `server/api/` segments:

| Method/path                  | Request → response                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET S/shima/map`            | `OwnerMap`                                                                                                                                                                       |
| `PUT S/shima/effort/:stepId` | `{baseRev, effort:ManualEffortInput}` → `{rev,map:OwnerMap}`; then refresh evidence-backed view                                                                                  |
| `GET K`                      | `{rev,packages:TaskPackage[]}`                                                                                                                                                   |
| `POST K`                     | `{baseRev,opportunityId}` → `{rev,package:TaskPackage}` (generate/rebase)                                                                                                        |
| `PATCH P`                    | `{baseRev,fields:Partial<TaskDraft>}` → `{rev,package:TaskPackage}`; at least one editable field                                                                                 |
| `POST P/preview`             | `{baseRev}` → `{rev,preview:PublicPreview}`; fixture preparation mode only                                                                                                       |
| `POST P/decision`            | `{baseRev,decision:'decline'}` or `{baseRev,decision:'approve-private',confirmedBudgetYen,confirmBudget:true}` → `{rev,package:TaskPackage}`; private approval is not release    |
| `POST P/publish`             | `{baseRev,previewId,previewHash,confirmedBudgetYen,confirmBudget:true,approvePreview:true}` → `{rev,package:TaskPackage,quest:PublicQuestDetail}`; fixture preparation mode only |

All new mutations use an `Idempotency-Key` header (UUID), scoped by principal, method and resource. Persist a fingerprint of canonical validated input (including `baseRev`) and a typed result reference in the **same commit**, not raw request/response bodies. Replay after auth and validation but before CAS: same key + same fingerprint returns the same result IDs projected from current retained state, with no second write; changed input is `409 idempotency_conflict`. Return `404` for deleted results and `409 stale_artifact` for invalidated previews; never recreate a result. Equal edits/duplicate generation or preview take no extra domain revision; a successful first-use no-op may record only its receipt. First-seen non-no-op writes require live `baseRev` and CAS. No silently rebasing on a lost CAS; `409 stale_revision` tells UI to refresh and review. Keep the P0 error envelope: generic `400 invalid_input`, `404 not_found` for wrong scope/disabled routes, `409 stale_artifact` for changed basis/preview, `422 fixture_unsupported` for unsupported fixture/budget, `422 consent_required`, `503 storage_unavailable`; never echo submitted fields/values in public errors. Set `Cache-Control: no-store` on data and private pages; redact private paths/identifiers, bodies, secrets and provider output from diagnostics.

## Exact preview, fixture-only public data and claims

```ts
type PublicTask = Omit<TaskDraft, 'proposedBudgetYen' | 'targetDate'> & {
	confirmedBudgetYen: number;
	targetDate: string;
	estimatedHoursSavedPerMonth: number | null;
};
type PublicPreview = { id: Id; hash: string; task: PublicTask };
type PublicQuestSummary = {
	id: Id;
	rev: number;
	state: 'available' | 'claimed';
	title: string;
	confirmedBudgetYen: number;
	targetDate: string;
};
type PublicQuestDetail = {
	id: Id;
	rev: number;
	state: 'available' | 'claimed';
	task: PublicTask;
};
type PublicClaimResult = { id: Id; rev: number; state: 'claimed' };
type Assignment = {
	id: Id;
	questId: Id;
	engineerKeyDigest: string;
	claimedAt: string;
};
```

`Omit` above is shorthand only for equal **field names**: code must define a separate strict public schema and explicit constructors, never spread or strip a private object or derive its validation from `TaskDraft`. `server/demo/shima-quest.ts` owns a checked-in versioned fictional catalog, initially one task for the documented hotel follow-up and `opp_hotel_02`. `server/shima/publication.ts` resolves eligibility from persisted seed identity + exact transcript fingerprint/documented answer and current fixture discovery/proposal binding (reuse/expose hotel binding; reject stale or mismatched fingerprints). `origin`, `mode`, arbitrary IDs, any client-supplied fixture/anonymized flags or strings, and even valid private package text are **never** proof of eligibility or sources of public values. Every public task value (including numbers, proposed date and confirmed yen) comes from that server catalog entry; sent yen is equality confirmation only. The fixture initially offers one catalog amount; if a private draft has a different amount, refuse preview rather than silently substitute it or use it as public input. The same rule applies if later adding options: only server-enumerated fixture variants. Real approval/release, automatic redaction and freeform public copy are out of scope.

Preview preparation stores an immutable typed snapshot with package ID, basis key and catalog variant/version separately from the mutable draft. Hash lower-case hex SHA-256 over the UTF-8 canonical JSON of `{schema:'shima-public-task-v1',task}` (keys recursively sorted lexicographically, arrays in order, compact JSON, no locale formatting or trimming). Return that exact task object; the UI shows all values, the proposed exact amount and a separate explicit owner approval control, not a regenerated or editable preview. `/publish` rechecks mode, owner role, CAS, matching preview ID/hash, recomputed hash, current basis/fixture, catalog match and explicit yen equality in one transaction. Store the owner actor/role and server time, approved preview hash and exact confirmed amount; then copy only the immutable approved task into a separate public snapshot with an opaque `qst_` ID and `rev:1`. Do not add author/revision context from the approval to public task content. Only wrapper availability/rev changes on claim, not the hashed task. Replays never duplicate or republish. Require a checked-in catalog byte match on public reads as well as strict output validation (including a retained version for existing approved fixture quests if catalog content changes); invalid stored public content fails closed, not best-effort sanitization.

| Public method/path (`/quests` is the UI) | Strict JSON; no private joins to produce responses                  |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/quests`                        | `PublicQuestSummary[]`                                              |
| `GET /api/quests/:questId`               | `PublicQuestDetail`                                                 |
| `POST /api/quests/:questId/claim`        | `{baseRev: number}` + `Idempotency-Key` → `PublicClaimResult` (200) |

A server-issued random demo-engineer cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS), issued on a board read before POST, scopes replays; this is not verified engineer identity or a real commitment. Require exact configured same-origin POST and a valid syntactic key/cookie. Under the existing store write queue read the quest and validate the public snapshot, check replay/current assignment, CAS on quest `rev`, and write `available → claimed` + exactly one assignment + receipt atomically. A same-engineer repeat returns the existing claim without another assignment or rev bump; a competing engineer gets `409 already_claimed` (one winner even with identical keys from different principals). An available quest with a stale `baseRev` gets `409 stale_revision`; absent/withdrawn quest is `404`. No in-memory-only assignment, payment, bidding, reassignment or real engineer undertaking.

## Storage and deployment boundaries

- Keep `server/store/repository.ts` as the only writer, with existing `NUXT_DATA_DIR/p0-store.json` (directory resolved from process cwd; default ignored `.data/`). Add strict optional Shima sections at snapshot level keyed by `SessionKey`, plus separate fixture quest/assignment sections; leave version-1 `Session` and read/write wire shapes intact. Absent extensions read empty; old writes preserve new sections and Shima writes preserve old clients, sessions, artifact keys, corrections and plans. Every `casSession` path preserves extensions and applies write-side invalidation/delete atomically, including older routes; snapshot validates before writing, temporary file sync + atomic rename through the existing queue. Missing store is allowed on fresh start; malformed primary/sections fail closed without reset. One process per directory, local disk only, no reliance on generated build assets, multi-process filesystems or memory. Always back up/restore offline and restart with the same **explicit absolute** directory for deployments. Never downgrade a populated Shima store to a writer that does not preserve these invariants.
- Baseline safeguards: `scripts/start.mjs` defaults to loopback but `NITRO_HOST`/`HOST`/socket override is not auth. `/api/clients/**` APIs scope child IDs but do not authenticate, and private views/API payloads can contain full original transcripts. There is no service-wide private cache policy, origin guard or role/tenant access control. Do not expose current raw Nitro/dev/preview port, even when credentials are absent. Use server-only `SHIMA_MODE` (`fixture-local` default, `public-demo`, `private-capture`) and `SHIMA_ORIGIN` (explicit trusted scheme/host/port for deployed modes); preserve existing single-user lifecycle, not permission to expose it. Add fail-closed guards in `server/middleware/shima-mode.ts` and protected launch settings (reject unknown mode, reject non-loopback overrides/unreviewed sockets for local modes; validate Host and unsafe-method Origin; no trust in forwarded claims). Guard APIs and pages including SSR/Nuxt payload paths, not just UI controls.
- `fixture-local`: dedicated synthetic directory only, local reviewer/demo-owner role, fixture prepare/approve, anonymous public-route simulation in a separate browser profile. `public-demo`: separate network deployment or allowlisted HTTPS proxy; serve only `/quests`, its static dependencies and exact list/detail/claim methods, no seed/private pages/API/provider endpoints or outbound provider config. Seed/publish through the loopback fixture mode beforehand, stop it, and restart on the same **synthetic-only** volume as `public-demo`; reject non-demo sessions and unexpected data at public startup, and read only separate catalog-bound public records. Never use the private volume for demo. Apply fixed public errors, strict small body and streaming byte limit, origin checks, and edge rate limits before Internet exposure. Existing general JSON parsing is not a streaming body cap.
- `private-capture`: distinct restricted OS-user directory and loopback-only built `npm start`, no public board/claim/publish/demo seed. Start on the designated single-user machine (physical/OS access boundary). `SHIMA_LOCAL_ROLE=reviewer` (default) allows capture/review/drafts but not approval; `owner` is reserved for an owner-operated instance, with a stable server-issued local principal (not proof of legal identity). No UI/API role switch. For unattended or shared municipal access, require reviewed authentication, per-business authorization, TLS/CSRF and restricted backups first; P0 does not claim that support. Use real notes or pasted/recorded Japanese/English transcript with permission, review and intentionally save edited rows, reopen privately and verify deletion. Without external consent keep material local. No fabricated interview, testimonial, consent or commitment. No raw audio by default; avoid PII in exports/screenshots/logs/commits, document retention and delete local artifacts/backups under the operator's policy, and disclose provider cleanup limitations separately.

For private capture, `PUT S/shima/consent/:purpose` with `{baseRev,noticeVersion,agreed:boolean}` returns `{rev,consent:ConsentReceipt|null}`. Closed purposes: `local-capture`, `recorded-stt`, `live-voice`, `external-analysis`. `ConsentReceipt = {purpose,noticeVersion,provider:string|null,actorId:Id,recordedAt:string}`; server chooses notice/provider from deployment config and records only actual participant acknowledgments attested by the operator. `agreed:false` revokes the scoped receipt and stops new egress. Require active local capture consent before private intake and both scope-specific receipt and existing per-operation positive confirmation before real external egress (including legacy analyze/proposal/batch routes); verify receipt matches the notice/provider in use. Never infer consent from a fixture, request flag alone, or a transcript. Deleting the transcript clears Shima content/receipts; it does not guarantee deletion of provider or backup copies.

## Voice seam — freeze now, choose transport after research

`shared/shima/interview.ts` publishes `InterviewTurn = {turnId: UUID; input: {kind:'utterance'; segments: NewSegmentInput[]} | {kind:'answer'; questionId: Id; text: string}}`; `NewSegmentInput` is `{speaker:string|null,text:string,startMs:number|null,endMs:number|null}` in the original language, with the same bounds as transcript intake. `POST S/shima/interview/turns {baseRev,turn:InterviewTurn}` → `{rev,session:Session}`, or call the same `commitInterviewTurn(key,baseRev,turn,context)` directly from a protected server adapter. Context derives origin (`text` or `live-voice`), authorized actor and consent, not arbitrary browser flags. Stable `turnId` is a durable dedupe key by session even across reconnect; conflicting content fails and a replay cannot resurrect deleted text. Append finalized **owner** rows via existing transcript mutation/citation cascade (mark microphone transcription `source:'audio'`), or atomically save a reply as the existing first-class answer, **not both**; no partial/assistant/tool transcript rows as evidence. Keep timestamps/editability and ordered writes; handle CAS conflicts visibly, do not resend as new turn IDs to force success.

Existing transcript PUT and turn commit feed the same `Session` and staged `discover`/`propose` through `/analyze`. Extract a reusable `runSessionDiscovery(key,{baseRev,mode,allowExternal},context)` around the current CAS/single-flight, consent and run key for server-side use. Persist turn first, then trigger revision-scoped discovery after an authorized finalized turn/batch, coalescing analysis calls; failure leaves saved input and last good map marked stale (no fallback). The next Japanese-first plain-language question derives from one open persisted question or a safe routine/time/tool/exception/goal prompt; send only what is disclosed and needed, never a parallel private evidence store. Dialogue state is the application session/revision plus minimal transport state; vendor dialogue may handle delivery, but cannot write facts or approve/publish. Ask one question at a time; allow stop/mic disable, paste fallback and private draft correction. Bound audio, duration (support roughly 30 minutes), call budgets and egress. Recordings keep their existing participant consent, batch approval/review and honest provider deletion status. Realtime must obtain actual mic/recording/processing consent before any connection/egress; do not claim zero retention or reuse a batch checkbox as realtime authorization.

Voice research proceeds in parallel with audit and does not gate this API: verify official ElevenLabs realtime transcription/speech or agent capabilities, credential availability without reading secrets into output, short-lived scoped browser tokens or server relay, supported locales, consent/retention and limits before selecting architecture. ElevenLabs handles voice I/O if verified; app owns source persistence, authorized dialogue state and analysis. Existing OpenAI-compatible analysis has server-only credentials and per-request egress consent; it is optional and must fail closed without config. Dify dialogue, OrcaRouter extraction, Linkup research, Neo4j graph and Neon persistence are evaluations, not required dependencies; use existing adapters only if useful and verified. If credentials/access are blocked, report live voice unverified and run the labeled fixture fallback, not simulated proof of live delivery.

## Handoff and acceptance

| Gate / owner                                     | Exclusive proposed work after the tracer                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audit + parent approval                          | This document; freeze wire, mode and voice seams. No app edits before approval.                                                                                                                                                                                                                                                                                                                                                            |
| Tracer worker (first, no parallel feature edits) | One API-first failing test and the minimal fixture slice through real store, then a minimal browser UI. Hand off exact paths, stable fixture IDs and checks; parent verifies on the shared base before the next wave.                                                                                                                                                                                                                      |
| Server + privacy                                 | `server/{api,store,middleware,shima}/**`, `server/utils/http.ts`, `tests/{api,store}/**`: package/preview/claim rules, persisted transitions, guard matrix and private receive/commit seams.                                                                                                                                                                                                                                               |
| Analysis                                         | `server/analysis/**`, `tests/analysis/**`: evidence-backed map projection and useful unanswered question selection using the existing stage/validation model; no provider/storage redesign.                                                                                                                                                                                                                                                |
| Owner/engineer UI                                | `app/pages/{shima,quests}/**`, any top-level route entry `app/pages/{shima,quests}.vue`, `app/components/shima/**` except `voice/**`, `app/composables/useShima*.ts`, `app/styles/shima*.scss`, `tests/ui/**`; existing workbench stays available.                                                                                                                                                                                         |
| Voice                                            | `server/voice/**`, `app/components/shima/voice/**`, `tests/voice/**`; integrates through turn/discovery seams. Any new endpoint in `server/api/**` is wired by Server from the published adapter.                                                                                                                                                                                                                                          |
| Fixture + QA                                     | `server/demo/**`, `tests/{demo,browser}/**`, `scripts/shima-*.mjs`, `README.md`: reviewed fixture catalog, repeatable safe seed/restart/dry-run script and operator/browser playbook. Reuse `scripts/dev-audio-stub.mjs` and `scripts/make-sample-audio.mjs`.                                                                                                                                                                              |
| Parent integration                               | `shared/{p0,shima}/**`, `scripts/start.mjs`, Nuxt/npm config, `.env.example`, `tests/smoke/**`, `LICENSE`: merge/coordinate cross-owner edits explicitly. Use worktrees or disjoint paths, small Angular commits; add root MIT `LICENSE` with maintainer-approved copyright holder and README link, optionally package `license` metadata (keep app `private:true`). Do not imply existing third-party assets/dependencies are relicensed. |

- **Persistence/correctness:** from an old version-1 store verify unchanged existing client/session/answer IDs and versions, edits, proposals, artifact keys and Markdown behavior before and after adding Shima state and restarting. Assert corrupt data fails closed, unrelated edits are preserved, unrelated rev changes do not alter basis, cited source changes stale/purge dependents appropriately, deletion cannot replay old artifacts, and failures leave the last saved state intact. Use dedicated ignored directories and free ports, never the operator store.
- **Approval/claim:** assert wrong/missing yen (including strings/fractions), missing explicit confirmations, wrong actor, stale revision/basis, changed draft, wrong preview ID/hash, changed bytes or catalog/fixture binding, real-session requests and forged fixture flags cannot publish. Independently recompute the preview hash and compare the served task bytes/values to the approved task, before and after claiming and restart. Race different principals and retry across restart (one assignment, one state transition; same key/different input rejected); inspect committed state, not only HTTP status.
- **Privacy:** assert exact positive key sets/types at every level on list/detail/claim (and fixed error envelope), and reject mutated stored task content. No nested arbitrary records/HTML or private types (`Session`, `TaskPackage`, `EvidenceRef`, `Assignment`, approval/consent data). Banned fields/values include company/client/session/package/preview/opportunity/step/source/assignment IDs, company/person/contact/location identifiers, speaker names, transcript/answer text and times, quotes/evidence, raw or detailed workflow/edges, private plan/integration credentials, owner/engineer identity, cookie/receipt values, model/provider payloads and secrets. Inject unique sentinels both inside allowed-looking private strings and under banned keys; confirm none in response or error, plus private/legacy pages/API/SSR data unreachable from `public-demo` and public release disabled in `private-capture` irrespective of request flags. Verify host/origin/mode guards and provider consent-before-egress via local stubs.
- **Independent demo:** run built server and browser, exercise Japanese-first Hear → Map → Match, evidence-linked private review, exact preview/yen and claimed status on reload **and process restart**. Test real capture and deletion in an isolated protected deployment only with authorized actual material; otherwise verify that path with a clearly synthetic dry run and report the real interview as not performed. Aim for about 60 seconds in the presentation; demonstrate relevant live follow-up only if verified, else use labeled role-play/prerecorded fictional fallback. Verify console and saved IDs. Clean install `npm ci`, then `npm test` (build + unit/API/smoke), `npm run typecheck`, `npm run lint`; run `npm run build` before focused API/smoke after source edits and `npm start` for browser QA. Report real check results, live vs stub and blocked/deferred work separately. Production auth/multi-tenancy, real publication, payments and infrastructure are not demo deliverables.
