# 女将の右腕 | Okami no Migiude

**Open the portal: [okami.musub.io](https://okami.musub.io/)**

Okami no Migiude — "the innkeeper's right hand" — is a bilingual (Japanese/English) portal that gives small businesses in Hokkaido an AI business check-up. Instead of filling in forms, the owner talks: a Shima Enaga (Hokkaido's long-tailed tit) voice agent asks how the business actually runs, and the portal turns that conversation into a management report the owner can download and bring to their municipality's support desk. The demo case is a family-run onsen inn in Jozankei.

> The interview offered today is a labelled sample interview (fiction); the people and dialogue are invented.

## How it works

1. **Create an account** with your name, email, business name and municipality, in Japanese or English.
2. **Talk to the Shima Enaga agent.** After agreeing to how the recording, transcription, automated processing and staff access are handled, the interview is a live voice conversation whose length the agent manages.
3. **Receive your report.** An automated assessment turns the transcript into a private report: a map of the current workflow, diagrams of any proposed changes, practical opportunities, and indicative estimates of time saved, effort and cost. An email with a private link arrives when it is ready.
4. **Take the next step.** Sign in to read and download the report and request an advisor consultation in one click. Designated staff are notified, can view the report, and take the introduction from there.

## Built with

- Nuxt 4 (Vue 3) and TypeScript on Node.js, with SQLite built into Node
- [ElevenLabs](https://elevenlabs.io) — the Shima Enaga voice agent and live transcription
- [Dify](https://dify.ai) — the automated assessment that writes the report
- [Linkup](https://www.linkup.so) — deep research into similar businesses, in and around the interview
- [Resend](https://resend.com) — report-ready email delivery
- [Hyper3D Rodin](https://hyper3d.ai) — the 3D Shima Enaga mascot

For contributors: [docs/mvp-contract.md](docs/mvp-contract.md) describes the shared interfaces and handoff, and the [scorecards](scorecards/) hold the MVP success criteria and evidence.
