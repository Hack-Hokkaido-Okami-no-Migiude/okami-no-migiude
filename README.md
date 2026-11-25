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

1. Switch between Japanese and English. Create an owner account for a fictional inn, select Accommodation, and enter Sapporo as the municipality.
2. Start the interview when ready. Confirm all consent items. Use the fictional script and its fill-transcript button, then submit. For another business, use the editable transcript instead. Optional browser recording stays local; this mode does not automatically transcribe or upload the audio.
3. Open the report. While the background worker analyzes the transcript, the owner can leave and return later. The report labels its analysis as a rule-based draft. For the inn, compare the current workflow with a shared booking calendar and calendar-driven cleaning list. Savings and costs are indicative estimates, not measured outcomes.
4. Open the owner's message in `.data/mail-outbox/`. Follow the report link in a signed-out window and sign in to view the private report. Download the Markdown attachment and request a consultation.
5. Sign in as the designated advisor and open `/staff`. The queue shows reports and consultation requests. The advisor can open a report, contact the owner, and handle introductions outside the app. The outbox contains a separate notification for each designated staff account.

## Live dependencies and limits

- The fictional script and optional local capture are **not** the teammate's live AI interviewer. Live interview and research are disabled until the browser session, consent and transcript handoff, and research endpoint are agreed and tested. No audio or transcript is sent to an external interview service.
- Email defaults to local `.eml` files; it does not deliver to inboxes. An opt-in Resend REST adapter is configured via `MAIL_LIVE_PROVIDER=resend`, `MAIL_RESEND_API_KEY`, and a verified `SMTP_FROM` sender, and still needs a test with real credentials and inboxes. Leave SMTP settings unset for the demo.
- This is a single-process prototype, not a public deployment. Before using real business data, review account and staff provisioning, rate limits, data retention, and mail and provider privacy terms. The public engineering board and implementation of recommendations are not included.

## Acceptance commands

```bash
npm run build
node --test tests/*.test.mjs
node tests/browser-journey.mjs --strict
npx prettier --check .
```

The browser harness uses Chrome or Edge and synthetic identities. See [MVP contract](docs/mvp-contract.md) for the shared interfaces and provisional handoff. Deadline checks use an accelerated clock or synthetic timestamps; they do not replace a full-hour physical microphone rehearsal.

Verified for this handoff: the production build, 90 automated tests, and all 34 strict Edge browser checks passed. The browser exercised the fictional inn from signup and consent through a ready report, a protected email link, a downloaded attachment, and a consultation request visible to staff. API tests also verified restart recovery, expiry, staff roster revocation, and cross-owner isolation. Resend was exercised only against a loopback substitute.
