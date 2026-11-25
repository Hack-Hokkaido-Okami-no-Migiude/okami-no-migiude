# Shima backend lane — handoff (2026-11-24)

Scope owned here: `server/shima/**`, session-scoped shima routes, `server/api/quests/**`,
`server/store/{repository,errors,ids}.ts`, `shared/shima/**`,
`tests/{api,store,smoke}/*shima*`. Everything else was left untouched; no commits made.

## Status: lane verified green on the merged tree

- `tests/api/shima-flow.test.ts` — 4/4 pass (against the built server with the
  boundary runtime plugin registered — thanks to the login-boundary agent's
  `nuxt.config.ts` wiring; verified present in the built plugins array).
- `tests/smoke/shima-flow.test.ts` — 2/2 pass (restart durability + claim race).
- `tests/store/shima-repository.test.ts` — 9/9 pass.
- Full `npm run test:unit` — 194/194 pass. `npm run lint` clean,
  `npm run typecheck` clean, `npm run build` clean.

## Behavior verified end-to-end (fixture build, real HTTP)

Owner flow hear → map → effort → package → preview → accept/reshape/decline →
publish → public board → claim → complete, plus:

- Exact preview hash (`sha256` over canonical `{schema:'shima-public-task-v1',task}`)
  and 13 public task fields; budget fixed to the active v2 catalog (80,000 yen,
  2026-12-18); effort estimate 月最大10時間 upper-bound labeling, fictionalization
  ban enforced.
- Publication requires a prior owner accept decision (`409 stale_artifact
  "Accept the package before publishing."` otherwise); reshape clears decision+preview.
- One durable winner: concurrent claim race admits exactly one; second loser 409.
- Receipts: publish replay after restart resends the original body (fingerprint
  binds the full publish body) → 200 same quest, no second quest; malformed
  replay body → 400; key reuse with different input → 409 idempotency_conflict.
- Purge: transcript deletion removes effort rows/packages/previews/quests,
  survives restart, board and store empty; old receipts cannot resurrect
  (replay after purge → 404 not_found).
- Catalog v2 predicate applied in list/detail/claim: archived v1 record is
  retained privately, hidden from the public board without rewriting history,
  detail/claim refused; active v2 still claims.
- No-leak errors: malformed/unknown quest IDs and cross-origin/forwarded-proto
  spoof attempts are rejected by the transport gate with the fixed
  `not_found "Not found."` body; no private markers in any public body.

## Test adjustments made (minimal, additive)

1. `tests/api/shima-flow.test.ts`
   - Unknown-quest and unknown-claim probes now use well-formed unknown
     `qst_<uuid-v4>` ids (the transport gate rejects malformed ids before the
     route, so sentinel paths cannot reach the route's fixed error).
   - Cross-origin and forwarded-`proto` spoof claim attempts are expected to be
     transport-gate 404s with the fixed body (route-level 400s are unreachable
     once the boundary is wired).
2. `tests/smoke/shima-flow.test.ts`
   - `publishCatalogQuest` records the accept decision before publishing
     (publication is refused without it).
   - The restart publish replay resends the exact original publish body
     (the receipt fingerprint binds it) and expects the same quest.
   - The post-purge replay expects `404 not_found` (purged package lookup fails
     closed before any gate; the old 409 stale_revision expectation predates the
     decision/receipt rework).

## Integration notes for the parent

- The repo build now enforces the pilot transport boundary only because
  `server/pilot/runtime.ts` is registered as a Nitro plugin (`nuxt.config.ts`,
  boundary agent). Without that wiring every route 404s fail-closed — do not
  drop the plugin when merging configs.
- Dev-server port reuse: if another `npm run dev`/test run holds a port, the
  smoke server picks the next free port; tests are port-agnostic.
- Known-good state: HEAD `6477350` + the uncommitted tree as of this handoff.

## Security

- No credentials, tokens, or `.env` content anywhere in this lane's diff.
- Fixture routes publish only the fictional catalog task; replay storage stays
  in the fixture tracer (typed references in the pilot lane only).
