# 女将の右腕 | Okami no Migiude

## Using the hosted example

**Open the portal: [okami.musub.io](https://okami.musub.io/)**

Okami no Migiude — "the innkeeper's right hand" — is a bilingual (Japanese/English) portal that gives small businesses in Hokkaido an AI business check-up. Instead of filling in forms, the owner talks: a Shima Enaga (Hokkaido's long-tailed tit) voice agent asks how the business actually runs, and the portal turns that conversation into a management report the owner can download and bring to their municipality's support desk. The demo case is a family-run onsen inn in Jozankei.

> The interview offered today is a labelled sample interview (fiction); the people and dialogue are invented.

## How it works

1. **Create an account** with your name, email, business name and municipality, in Japanese or English.
2. **Talk to the Shima Enaga agent.** After agreeing to how the recording, transcription, automated processing and staff access are handled, the interview is a live voice conversation whose length the agent manages.
3. **Receive your report.** An automated assessment turns the transcript into a private report: a map of the current workflow, diagrams of any proposed changes, practical opportunities, and indicative estimates of time saved, effort and cost. An email with a private link arrives when it is ready.
4. **Take the next step.** Sign in to read and download the report and request an advisor consultation in one click. Designated staff are notified, can view the report, and take the introduction from there.

## Building and running the project

### Services and accounts

The app starts runs locally but relies on third-party services. These services are required, so it's neccessary to sign up or use an existing account.

- **Live interviews.** Create or configure a Shima Enaga agent in ElevenLabs with the supplied [system prompt](docs/agent-system-prompt.md) and [knowledge base](docs/agent-knowledge-base.md). Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`. Configure the signed post-call transcription webhook at `/api/voice/elevenlabs/post-call` on your app's public HTTPS origin and set `ELEVENLABS_WEBHOOK_SECRET` to its signing secret. [ElevenLabs signup](https://elevenlabs.io/app/sign-up)
- **Report generation.** Set up and publish the [Dify assessment workflow](docs/dify-assessment.md) and put its app API key in `DIFY_API_KEY`. The imported workflow defaults to OpenAI. Use an OpenAI API account and configure its key in Dify, or select a chat model already configured in your Dify workspace. With Dify disabled, the app stores completed interview transcripts and report generation is unavailable. [Dify Cloud signup](https://cloud.dify.ai/signup) · [OpenAI API signup](https://platform.openai.com/signup)
- **Research.** Get a Linkup API key for `LINKUP_API_KEY` and generate a shared secret for `RESEARCH_TOOL_SECRET`. Configure the ElevenLabs tool to send a `POST` to `/api/voice/elevenlabs/start-research` on the public HTTPS origin, with `Authorization: Bearer <RESEARCH_TOOL_SECRET>` and the JSON fields `conversation_id`, `business_name` and `location`. [Linkup dashboard](https://app.linkup.so/)
- **Sending emails.** Get a Resend API key for `MAIL_RESEND_API_KEY` and set `MAIL_FROM` to an authorized sender address. With the API key unset, the app writes report email as `.eml` files under `.data/mail-outbox/` by default. [Resend signup](https://resend.com/signup)
- **Optional cloud copy.** Create a Neon database, apply the [Neon schema](db/schema.sql) and set `NEON_DATABASE_URL` to the database connection string. [Neon getting started](https://neon.com/docs/get-started/signing-up)

### Run locally

Use Node.js 26 and npm 11. The app uses Node's built-in SQLite and creates its database at `.data/app.db` on first start.

```sh
git clone https://github.com/Hack-Hokkaido-Okami-no-Migiude/okami-no-migiude.git
cd okami-no-migiude
npm ci
cp .env.example .env
```

Edit the new `.env` using [`.env.example`](.env.example) as a reference. To enable staff access, set `STAFF_EMAILS` to a comma-separated list of addresses and `STAFF_PASSWORD` to their shared initial password. The app creates staff accounts at startup.

```sh
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). For development with hot reload, run `npm run dev` in place of the build and start commands. Both start commands load `.env`.

If you use a different browser URL, set `PUBLIC_BASE_URL` to its exact origin (scheme, host and port). The app uses this origin to accept browser writes and build report links. The production server listens on `127.0.0.1` by default. Set `HOST` or `NITRO_HOST` if your deployment needs another listen address.

## Built with

- Nuxt 4 (Vue 3) and TypeScript on Node.js, with SQLite built into Node
- [ElevenLabs](https://elevenlabs.io) — the Shima Enaga voice agent and live transcription
- [Dify](https://dify.ai) — the automated assessment that writes the report
- [Linkup](https://www.linkup.so) — deep research into similar businesses, in and around the interview
- [Resend](https://resend.com) — report-ready email delivery
- [Hyper3D Rodin](https://hyper3d.ai) — the 3D Shima Enaga mascot

For contributors: [docs/mvp-contract.md](docs/mvp-contract.md) describes the shared interfaces and handoff, and the [scorecards](scorecards/) hold the MVP success criteria and evidence.
