# Okami no Migiude MVP success criteria and agent scorecards

Use the build brief for product scope. Use this companion to agree on the evidence for each assignment and review the finished work. The demo case is a family-run Jozankei inn in Sapporo City (札幌市).

## MVP success criteria

Use the [owner journey scorecard](owner-journey-scorecard.md) and [staff and advisor journey scorecard](staff-journey-scorecard.md) to run the integrated walkthrough and record evidence for the checks below.

| ID  | Area                          | Pass when                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Signup and language           | A new owner can start from the homepage, switch the website between Japanese and English, and create an account using name, email, business name and municipality. The optional contact and notes fields can be left empty. The owner can sign back in with the account email and password. The language choice persists across pages and later visits. |
| 2   | Consent and browser interview | A signed-in owner can start when ready. The site explains that Shima Enaga is AI and asks for recording and transcription consent before capture. Verify that withholding consent prevents capture, finishing early ends it, and the one-hour limit ends it automatically.                                                                                                                                                                                                          |
| 3   | Interview handoff             | The website receives the completed interview data through the agreed interface and associates it with the correct owner. Record whether the teammate’s voice agent and live research were exercised.                                                                                                                                                                                                                                                                                |
| 4   | Report processing and content | Completing the interview starts analysis automatically. The owner can return while it runs and see the finished report later. The report maps the current workflow and, where a recommendation changes the process, diagrams the proposed workflow alongside it. It ranks practical opportunities and shows current effort, potential time savings, estimated implementation effort and cost, and the basis for those estimates. Show existing-tool or custom options where useful. If preparation fails, the site shows an unavailable state and sends no report-ready email. |
| 5   | Owner delivery and privacy    | A ready report triggers one email containing a link to the private report. The owner signs in and can open and download it. Verify that a signed-out visitor and a different owner cannot access the report or download through the link.                                                                                                                                                                                                                                           |
| 6   | Staff and consultation        | Designated staff are notified and can view the report as soon as it is ready. Another user without staff access cannot use the staff view. The owner can request a consultation, and designated staff can see the request.                                                                                                                                                                                                                                                          |
| 7   | Integrated demo and handoff   | The lead runs the merged app through the inn journey, verifies the access checks, and supplies run instructions, evidence, and a list of dependencies with live verification still pending. Label any test substitute in the demo and handoff.                                                                                                                                                                                                                                      |

Record a result against each criterion. Use **Pass**, **Verified with substitute**, **Failed**, **Blocked**, or **Unverified**. For a check with both local and external parts, record each result. A test substitute can demonstrate the app workflow. Record live provider verification separately. Report any open MVP check and its impact on the demo. Review the public engineer board as stretch work after the core path works.

### Automated evidence map

Run the automated acceptance suite before the manual walkthrough: `npm run build`, then `node --test tests/*.test.mjs`, then `node tests/browser-journey.mjs --strict`. Format and lint gates are `npx prettier --check .` and `npx eslint app server shared scripts tests --quiet`. A journey check can cite an automated result as evidence when the test covers the same behavior; record live-provider checks separately from substitute-backed automated results. The app ships labeled substitutes for the demo, including the local mail driver (`server/mail/local.ts`) and the configurable voice providers (`server/voice/providers.ts`).

| Criterion | Automated evidence |
| --- | --- |
| 1 | `shell-pages.test.mjs` (signup form, sign-in credentials, localized homepage) and `shell-contracts.test.mjs` (ja/en dictionary parity, locale and session state) |
| 2 | `interview-consent.test.mjs` (capture refused until every disclosure is acknowledged), `interview-capture.test.mjs` (start, early stop, permission failure, cleanup), `interview-deadline.test.mjs` (countdown from the server deadline and the hard cut), `interview-flow.test.mjs` (draft resume and the retryable unavailable state) |
| 3 | `interview-api.test.mjs` and `interview-transcript.test.mjs` (agreed payload interface), `voice-journey.test.mjs` and `voice-webhooks.test.mjs` (voice integration); live research verification is recorded separately |
| 4 | `report-content.test.mjs` (analyzer and parser sections in JA and EN, empty-state and hostile transcripts), `interview-flow.test.mjs` (resume and unavailable states) |
| 5 | `report-page.test.mjs` and `report-probe.test.mjs` (gated report view and download); `mail-live.test.mjs` for the live email provider, recorded separately |
| 6 | `staff-journey.test.mjs` (neutral staff shell, staff-only queue with consultation state, cross-owner denial); the browser journey's manual checklist adds the staff wall on the interview page and the role persistence checks |
| 7 | `tests/browser-journey.mjs --strict` (merged end-to-end journey) plus the build, format and lint gates |

## Lead agent scorecard

Score the merged result after independent checks. The lead owns fixes and integration until the demo can be handed over.

| Dimension                | Evidence for 2 points                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope and priorities     | The work plan starts with the owner journey. Each delegated task maps to acceptance criteria. Stretch work follows the core path.                                                                 |
| Delegation and ownership | Each worker received the goal, file ownership, inputs, dependencies and checks. Shared interfaces have named owners and coding assignments follow the build brief’s model and effort requirement. |
| Integration              | The lead reviewed and integrated the workers’ changes, exercised the shared interfaces, and rechecked fixes in the merged app.                                                                    |
| Acceptance               | The lead ran the inn journey, checked owner and staff access, and recorded a result and evidence for each MVP criterion.                                                                          |
| Demo and handoff         | The run instructions work. The handoff identifies the demo path, exact checks performed, test substitutes and remaining blockers or live checks.                                                  |

## Subagent scorecard

Use one scorecard per assignment. The worker supplies evidence and the lead checks it at review.

| Dimension                   | Evidence for 2 points                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope and ownership         | The agreed outcome is delivered in the owned files. Changes to shared contracts or another worker’s files were coordinated.                            |
| Behaviour and integration   | The change works through its normal entry point, meets the assigned checks and respects the shared inputs and outputs.                                 |
| Maintainability and commits | Names and file structure explain the work. Changes follow the coding conventions and are grouped in small, coherent Angular-style commits.             |
| Verification                | The handoff gives reproducible commands or browser steps and their actual results. Failures, missing dependencies and test substitutes are identified. |
| Handoff                     | The lead can find the commits and changed paths, integrate the result, and see what is ready or blocked.                                               |

Examples of assignment evidence include a signup and language-switch run for the website worker, consent and timed-stop tests for the interview worker, a diagram and report-email run for the report worker, and role-access and consultation checks for the staff worker.

## Scoring and handoff

For each dimension, use **2** for complete with evidence, **1** for partial, and **0** for unmet or missing evidence. Mark an inapplicable dimension **N/A** and explain why. Use the scores to decide what to fix or verify next. The MVP criteria determine readiness.

### Score record

| Agent and assignment | Dimension | Score | Evidence | Next action |
| -------------------- | --------- | ----- | -------- | ----------- |
|                      |           |       |          |             |

### Assignment handoff

| Worker and scope | Acceptance IDs | Changed paths and commits | Checks and results | Blocker and next action |
| ---------------- | -------------- | ------------------------- | ------------------ | ----------------------- |
|                  |                |                           |                    |                         |

### Lead acceptance record

| Acceptance ID | Result | Environment or substitute used | Evidence | Fix owner or next action |
| ------------- | ------ | ------------------------------ | -------- | ------------------------ |
|               |        |                                |          |                          |
