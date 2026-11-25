# 女将の右腕 | Okami no Migiude

A bilingual municipal support demo for small businesses. Owners create an account, complete a Shima Enaga interview, receive a private workflow assessment, and can request an advisor consultation. The sample business is a fictional family-run onsen inn in Jozankei.

## Run locally

Use Node 26 (built-in SQLite) and npm 11. From the repository root:

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Open **http://localhost:3000**. Use the exact origin configured as `PUBLIC_BASE_URL`; it controls browser write checks and links in mail. `npm start` binds to `127.0.0.1` by default. For development use `npm run dev -- --host 127.0.0.1`. Keep the demo local and use invented data only. SQLite, transcripts, reports, and local mail files live in the ignored `DATA_DIR` (default `.data`). Use a fresh subdirectory for a rehearsal instead of deleting working data.

To enable staff review, set `STAFF_EMAILS` to one or more synthetic addresses (for example `advisor@example.test`) and choose a `STAFF_PASSWORD` in `.env` before starting. At boot, addresses removed from the roster lose access and their unsent staff messages are removed. Use a separate browser profile to sign in as staff while the owner is signed in.

## Demo walkthrough

1. Switch between Japanese and English. Create a fictional inn account with the owner's name, email, business name, and Sapporo as the municipality. Set a password for sign-in. No business type is needed.
2. Start the interview when ready. Confirm all consent items. Enter a fictional transcript in the editor; for example, describe how phone and online bookings get copied into a notebook and how staff use it to schedule cleaning. Optional browser recording stays local; this mode does not automatically transcribe or upload the audio.
3. Open the report. While the background worker analyzes the transcript, the owner can leave and return later. The report labels its analysis as a rule-based draft. Savings and costs are indicative estimates, not measured outcomes.
4. Open the owner's message in `.data/mail-outbox/`. Follow the report link in a signed-out window and sign in to view the private report. Download the Markdown attachment and request a consultation.
5. Sign in as the designated advisor and open `/staff`. The queue shows reports and consultation requests. The advisor can open a report, contact the owner, and handle introductions outside the app. The outbox contains a separate notification for each designated staff account.
6. Optionally open **音声面談 / Voice chat** from the dashboard. Without voice credentials the page shows an honest "unavailable" notice; with credentials it starts a live AI voice chat (see below).

## Voice chat (AI agent)

Owners can also talk to the Shima Enaga voice agent from the signed-in dashboard. The call is **conversation only**: it records consent, the transcript, and background research on similar businesses — it never creates an interview or a report row.

Voice chat stays off until every required credential is present in `.env` (placeholders in `.env.example`): `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET` (verifies the signed post-call webhook), `RESEARCH_TOOL_SECRET` (bearer token for the agent's start-research tool), and `LINKUP_API_KEY`. When all are set, `GET /api/voice/config` reports `available: true` and the dashboard entry works; otherwise `/voice` shows the unavailable panel. The browser connects through the ElevenLabs WebRTC SDK (`@elevenlabs/client`, pinned version); audio is processed live by ElevenLabs and is never stored by this app — only the transcript (`Owner:` / `Shima Enaga:` lines) and the research cases are saved.

While the call runs, the background worker submits a Linkup deep-research task built from the owner's profile (business name and municipality) and hands the sourced cases to the agent mid-call. The ElevenLabs agent keeps its existing webhook tool configuration: `POST /api/voice/elevenlabs/start-research` (Bearer `RESEARCH_TOOL_SECRET`, idempotent 202) and `POST /api/voice/elevenlabs/post-call` (HMAC `ElevenLabs-Signature`, always 200). For QA, `ELEVENLABS_API_BASE_URL` and `LINKUP_API_BASE_URL` can point the provider calls at loopback stubs (plain HTTP is accepted for loopback hosts only), mirroring `MAIL_RESEND_BASE_URL`.

## Live dependencies and limits

- The fictional script and optional local capture are **not** the teammate's live AI interviewer — the scripted interview keeps feeding the rule-based draft report. The live AI voice chat (see _Voice chat_ above) is conversation only and stays disabled until its credentials are configured; the report pipeline does not consume voice transcripts yet.
- Email defaults to local `.eml` files; it does not deliver to inboxes. Resend is the only live email service: set `MAIL_RESEND_API_KEY` (and optionally `MAIL_FROM` as the sender) to enable idempotent REST delivery. Without a key nothing leaves the machine. Live delivery still needs a test with real credentials and inboxes.
- This is a single-process prototype, not a public deployment. Before using real business data, review account and staff provisioning, rate limits, data retention, and mail and provider privacy terms. The public engineering board and implementation of recommendations are not included.

## Acceptance commands

```bash
npm run build
node --test tests/*.test.mjs
node tests/browser-journey.mjs --strict
npx prettier --check .
```

The browser harness uses Chrome or Edge and synthetic identities. See [MVP contract](docs/mvp-contract.md) for the shared interfaces and provisional handoff. Deadline checks use an accelerated clock or synthetic timestamps; they do not replace a full-hour physical microphone rehearsal.

Verified for this handoff: the production build, 100 automated tests, and all 39 strict browser checks passed (the harness auto-detects Chrome/Edge on macOS and Windows). The browser exercised the fictional inn from signup and consent through a ready report, a protected email link, a downloaded attachment, a consultation request visible to staff, and the `/voice` guard pages for owner and staff sessions while voice is unconfigured. API tests also verified restart recovery, expiry, staff roster revocation, cross-owner isolation, and the voice session/research/webhook lifecycle against loopback provider stubs. Resend was exercised only against a loopback substitute.
