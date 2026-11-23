# Workbench QA handoff

Base: `d292263d71c4c3fc332163af108527e8161bffc4`. UI files are scoped to `app/pages/index.vue`, `app/layouts/default.vue`, `app/components/workbench/`, `app/composables/`, `app/styles/`, and `tests/ui/`. The browser uses the published HTTP contract only. No dependencies, runtime config, server, or shared schema changes are part of this work.

## Repeat the browser workflow

- Use an unused loopback port and a fresh ignored `.data/` directory; do not point QA at an existing interview store. Example from Git Bash: `NUXT_DATA_DIR="$PWD/.data/qa-workbench" npm run dev -- --host 127.0.0.1 --port 43117` (use a native absolute path instead if needed on Windows). Set live variables explicitly for the desired test; do not use external credentials for routine QA. Wait for the initial load to finish before interacting with SSR controls.
- **Fixture:** choose **Open hotel fixture demo**, then **Analyze fixture interview**. In **Current workflow**, focus a step or a named transition and select it with Enter. In **Finding details**, choose **View source**; the transcript scrolls to and focuses the verbatim highlighted quote. Nodes and handoff links are an adjacency diagram with textual edge kind and target; row order does not imply a transition. A review-only finding stays inspectable and does not appear as a diagram node.
- **Review and reanalysis:** choose **Review step name** on the first step and **Verify finding field**. Confirm **Discovery needs refresh**, rerun fixture analysis, and verify the same claim is still consultant-verified. For the unverified path, choose **Review role**, edit the value, and choose **Save correction** (see backend blocker below). To test answer grounding, open **Follow-up questions** → **Record answer**, save the exact `HOTEL_DEMO_FOLLOWUP_ANSWER` from `server/demo/hotel.ts`, and verify it leaves the open list immediately. Rerun fixture analysis; confirm 8 nodes / 7 transitions for the documented variant versus 7 / 6 for the initial version, the retained correction/verification, and the answer under **Question history**. Select the new answer-supported handoff and follow its answer citation.
- **Opportunity and plan:** open **Opportunities & plans**, select a ranked opportunity, then **Create fixture proposal**. Check the two distinct selectable diagrams and the **Proposed workflow · hypothesis** label. Choose **Edit plan sections**, edit Scope, and save; status resets to Draft. Select **In review** or **Approved** and **Save review status**; approval has no deployment effect. **Download Markdown** uses the persisted plan, attachment name `implementation-plan.md`, and all seven plan sections. Edit monthly occurrences to `0` and save: the estimate reads `0 hours / month`, and approval/export are blocked until regeneration. Verify plan ID and edited sections survive regeneration. An overall stale discovery also blocks approval/export, regardless of the selected proposal flag.
- **Client intake and isolation:** in the rail, use **New client** → **Create client**, then **New interview** → **Create interview**. In **Paste transcript**, paste `[00:02.500–00:07] 受付：台帳を確認します。` and `[支配人] 変更があれば連絡してください。` on separate lines. Save and check speaker, timestamps, exact Japanese text, revision and reopened session. In the client selector, only the selected client's interviews should be offered. Edit/reorder rows without resubmitting generated IDs for new rows. Use **Delete transcript** → **Confirm transcript deletion** to clear all dependent analysis.
- **Stale revision:** start a transcript edit, change a saved row through a second tab or the API, then try saving the first draft. The stale message offers **Load latest revision** and does not retry the write. The textbox contents remain; after loading latest, compare the saved rows and explicitly acknowledge replacement before reapplying. If loading latest would remove a review target with a possible draft, decline the warning to keep and copy the draft first.
- **Live privacy and failure:** opening the live controls only reveals the disclosure; it does not start a request. Cancel leaves the saved artifact untouched. Confirm requires a newly checked per-operation checkbox for discovery or proposal. Test unconfigured and malformed or 503 responses using a loopback OpenAI-style stub at `/v1/chat/completions`; no real provider is necessary. Check the error details, no mode switch/fallback, and exact saved revision/graph unchanged.

## Verification on the implementation workspace

- `npm run typecheck` passed; Nuxt printed the existing devtools deprecation warning.
- `./node_modules/.bin/eslint --max-warnings 0 app/pages/index.vue app/layouts/default.vue app/components/workbench app/composables tests/ui` passed. `node --import tsx --test tests/ui/*.test.ts` passed 7 tests. `git diff --check -- app tests/ui` passed.
- Browser on 43117 (`.data/workbench-browser`): fixture discovery, keyboard selection/quote focus, verified finding across reanalysis, documented answer and resulting transition, separate proposal, edited plan, in-review status, Markdown filename/all sections, zero savings and stale export/approval, Japanese creation/edit, stale edit preservation and explicit reapply, client isolation, browser reload and transcript deletion all exercised. After restarting on that same directory, reopened the same hotel/client IDs from the rail, verified the saved answer and finding, regenerated the same plan with its edited Scope, and approved it. At 390px, client controls collapse and expand without horizontal overflow. A canceled live disclosure produced no request; unconfigured live showed a useful error with the previous graph intact.
- Browser on 43118 (`.data/workbench-provider-browser`) with loopback stub on 43119: malformed JSON then 503 reused the last good fixture graph and revision; the stub observed one malformed call and two 503 calls (one retry). Desktop/narrow screenshots are in `.data/workbench-provider-browser/evidence/`; the inspected 390px viewport had no horizontal overflow. Successful external live requests were not attempted.

**Integration blocker — resolved during integration:** the blocker below was
real and is now fixed in the storage seam, not worked around in the UI.
`consultantClaimCore` in `server/store/claims.ts` sets
`inference: UNVERIFIED_CORRECTION_INFERENCE` on non-verified corrections, and
`server/store/corrections.ts` now keeps `graphEligible` in sync when a label is
cleared. Retested over the published HTTP API: unverified string, list, and
execution corrections save, persist, stale discovery and dependent proposals,
and survive re-analysis with the correction intact
(`tests/store/corrections.test.ts`); the built-server smoke exercises the
correction/answer flows end to end (`tests/smoke/p0-slice.test.ts`). The UI
sends `PATCH …/steps/:stepId` with `verify:false` and `{ value, evidence }`
exactly as contracted — no extra field, no relabeling.

Original report (kept for traceability): the UI sent the contracted correction
and the server returned 503 `storage_unavailable` because
`consultantClaimCore` produced `state:'inferred'` without the `inference` label
required by `shared/p0/schemas.ts` (`inferred claims require a non-blank
inference label`).

## Canonical demo browser walkthrough (exact labels and anchors)

Views switch on the rail buttons `#view-discovery`, `#view-questions`,
`#view-plans` (headings: `#session-rail-heading`, `#current-workflow-heading`,
`#finding-heading`, `#follow-up-heading`, `#opportunities-heading`,
`#plan-editor-heading`, `#graph-comparison-heading`, `#transcript-heading`).
All quoted strings below are verbatim button/label text.

1. Seed: in `#client-controls` choose **Open hotel fixture demo** (aria
   busy label while loading: "Opening hotel fixture…"), then under
   `#current-workflow-heading` click **Analyze fixture interview** (repeat runs
   are labeled **Rerun fixture analysis**).
2. Review: click a diagram step or named transition (adjacency list — rows are
   steps, each transition row states edge kind and target), then in
   `#finding-heading` use **View source** to focus the verbatim quote. Click
   **Review step name** / **Review role** (label = "Review " + the lowercase
   field name). Claim state pills read "Consultant verified", "Client
   confirmed", "Inferred", "Unknown".
3. Unverified correction: in **Review role** change the value and click
   **Save correction** (no verify toggle). Expected: saved as state "Inferred",
   HTTP `PATCH …/steps/:stepId` with `verify:false` succeeds (the old 503 is
   fixed), "Discovery needs refresh" appears.
4. Reanalysis contract: click **Rerun fixture analysis**. The unverified
   correction keeps its value/state; a **Verify finding field** correction
   stays "Consultant verified".
5. Follow-up answer: `#view-questions` → **Record answer** (or **Edit
   answer**), save the exact `HOTEL_DEMO_FOLLOWUP_ANSWER` text from
   `server/demo/hotel.ts`; any other wording is rejected. The question leaves
   **Open questions** immediately. **Rerun fixture analysis** → 8 nodes /
   7 transitions, new opportunity under `#opportunities-heading`.
6. Proposal and plan: `#view-plans` → select an opportunity → **Create fixture
   proposal** (repeat: **Regenerate fixture proposal**). `#graph-comparison-heading`
   ("Graph comparison") shows the two side-by-side selectable diagrams under
   "Current workflow snapshot" and "Proposed workflow hypothesis" — click a
   node in either to inspect it.
   **Edit plan sections** → edit **Scope** → save (status resets to Draft).
   Choose **In review** or **Approved** → **Save review status**. **Download
   Markdown** saves `implementation-plan.md` with all seven headings (Scope,
   Business rules, Integrations & auth, Exceptions, Human oversight,
   Milestones, Acceptance tests).
7. Zero-savings and stale gates: set monthly occurrences to `0`, save — the
   estimate reads `0 hours / month` and approval/export are blocked until
   regeneration; with stale discovery, approval/export are blocked for all
   dependent proposals.
8. Intake and isolation: **New client** → **Create client**, **New interview**
   → **Create interview**, paste `[00:02.500–00:07] 受付：台帳を確認します。`
   into the `#paste-format` textbox, save, verify speaker/timestamps. The
   client selector offers only the selected client's interviews.
9. Stale revision: edit a saved row from a second tab/API, then save the first
   draft — the stale message offers **Load latest revision** and keeps the
   draft text. Transcript deletion asks **Confirm transcript deletion**.
10. Live consent: **Analyze with live provider…** (repeat: **Rerun live
    analysis…**) opens a disclosure titled "Send source material to the live
    provider?" with the per-operation checkbox "I consent to sending this
    interview material for discovery." (or "… for proposal.") and buttons
    **Confirm live discovery** / **Confirm live proposal** / **Cancel**.
