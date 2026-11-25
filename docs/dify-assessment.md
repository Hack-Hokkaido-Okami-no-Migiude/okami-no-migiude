# Dify voice assessment workflow

Setup for the post-call assessment. Both research passes run on Linkup, from
the server: a quick in-call pass at reasoning depth `S` while the owner is
still talking, and after the call a second, transcript-informed pass at the
heaviest depth (`XL`) that returns a full sourced dossier — workflows, named
tools with pricing, implementation effort — not just case stubs. Dify only
writes the report: it receives the transcript, the business intake and the
research evidence (in-call cases plus the dossier), and returns the finished
Markdown. The workflow needs no tools and no web-search plugin, just a model
provider.

## How the server calls it

`POST {DIFY_API_BASE_URL:-https://api.dify.ai}/v1/workflows/run` with the app
key from this workflow (env `DIFY_API_KEY`), `response_mode: 'streaming'`,
`user: <conversation_id>`. The server resolves the run when the
`workflow_finished` event arrives and reads `data.outputs.report`. Blocked or
empty reports count as a failure (retried with backoff, max 5 attempts).

## Create the workflow in Dify Studio

**Fast path — import the ready-made DSL:** `docs/dify-voice-assessment.dsl.yml`
in this repo builds the whole graph (4 Start variables → Report writer LLM →
End with the `report` output). In Studio: **Apps → Import from DSL file** →
select the file → open the **Report writer** node and pick your workspace's
chat model if it shows as unconfigured → **Publish**. Skips steps 2–6 below.
If you imported an older version of this file, delete the app and import the
current one (the Ground-rules paragraph changed).

1. Sign in to [Dify Cloud](https://cloud.dify.ai/). Under
   **Integrations → Model Provider**, make one chat model available
   (OpenAI plugin + API key from platform.openai.com — ChatGPT-plan credits
   don't apply here). No tool plugins are
   needed — the research already happened on the server.
2. **Studio** → **Create from Blank** → **Workflow**, name it
   `Voice assessment`.
3. On the **Start** node add four **User Input** variables. Use these exact
   names — the server sends them as-is:

   | Variable name | Field type | Value |
   |---|---|---|
   | `transcript` | Paragraph | Final signed call transcript (`Owner:` / `Shima Enaga:` turns) |
   | `business` | Paragraph | JSON text: business name, location, type |
   | `research_cases` | Paragraph | JSON object: `{ "in_call_cases": [...], "deep_research_report": { "answer": "...", "sources": [...] } \| null }` |
   | `report_language` | Select | Exactly two options, `English` and `Japanese` |

4. Add one **LLM** node after Start (the model from step 1). System prompt:

   ```text
   Write the business consultation report in {{report_language}}. Use these
   Markdown sections with headings in the chosen language only (Japanese
   first, English second):

   # 経営相談レポート / Business consultation report — plus the business name
   > one line noting this is an AI draft based on the interview and web research
   ## まとめ / Summary — the owner's situation and the top opportunities
   ## 改善フローの比較 / Flow comparison — 現在の流れ (current flow) and 改善後の流れ (improved flow) as numbered steps
   ## ボトルネック / Bottlenecks — one bullet each, from the transcript
   ## 削減できる時間と前提 / Time savings and assumptions
   ## 導入の負担 / Implementation workload
   ## 概算費用（目安）/ Indicative costs
   ## 既製品と独自開発 / Off-the-shelf or custom
   ## 次のステップ / Next steps — three numbered actions
   ## 参考情報 / Sources — the URLs actually used

   Ground rules: the transcript is the owner's evidence and the only source
   for what they said. The research evidence is external material:
   `in_call_cases` are the cases researched during the call, and
   `deep_research_report` — when present — is a deeper sourced dossier with
   technical detail; prefer its specifics and cite the URLs it lists inline.
   When `deep_research_report` is null, note that deeper research was not
   available this session. Mark suggestions that still need validation with
   要確認 (to be verified). Never present an estimate as a fact. Mask
   personal names, phone numbers and addresses from the transcript. Keep the
   tone concrete and respectful, written for the owner.
   ```

   User prompt (use the variable picker for the four variables):

   ```text
   Interview transcript:
   {{transcript}}

   Business profile:
   {{business}}

   Research evidence (in-call cases plus the deep dossier):
   {{research_cases}}
   ```

5. **End / Output node** after the LLM node: one output variable named
   `report`, value = the LLM node's `text`. The server reads only
   `outputs.report`. The canvas reads Start → LLM → End.
6. **Test run**: transcript `Owner: I spend about two hours a week copying
   bookings by hand.`, business `{"businessName":"Test Inn","location":"Niseko",
   "businessType":"family-run inn"}`, research_cases
   `{"in_call_cases":[],"deep_research_report":null}`, report_language
   `English`. Confirm the run returns a `report` in English that uses the two
   hours as the owner's estimate. Then **Publish**.
7. **API key**: open the app → **API Access** → create an app key → put it in
   `.env` as `DIFY_API_KEY`. Do not commit it.

## What the server does around the workflow

- **Pass 1 (in-call):** Linkup `/research` at `reasoningDepth: "S"` with
  `outputType: "structured"` (2–5 minutes, $0.25) seeded from the intake, so
  sourced cases can join the conversation while it is still running.
- **Pass 2 (post-call):** the stored transcript is reduced to matched topic
  titles with deterministic keyword rules — no transcript text leaves the
  server — then Linkup `/research` runs at `reasoningDepth: "XL"` with
  `outputType: "sourcedAnswer"` (10–20 minutes, $2.50 per call; drop to `"L"`
  for $1.50 and 5–10 minutes if latency or cost matters), the focus topics
  steering the query. The result is a full dossier: step-by-step workflows,
  named tools with documented pricing and integrations, implementation
  effort, results at comparable businesses, and risks — every claim carrying
  its source.
- The Dify `research_cases` input carries the evidence as one JSON object:
  `in_call_cases` (the in-call case list) and `deep_research_report`
  (`answer` + `sources`, or `null` when the deep pass failed).

## Failure behavior (server side)

- In-call research still running when the call ends: the assessment waits
  until it reaches a terminal state (10-minute deadline included) before
  starting the deep pass.
- Deep-pass submission, polling or timeout failure is graceful: the report
  ships with the in-call cases only (or none), and the session API still
  completes.
- Each failed Dify run retries with exponential backoff (30 s × 2^attempts),
  max 5 attempts, then the assessment is marked failed: no report row, no
  mail, and the voice status API reports `assessment.status = 'failed'`.
- A crashed in-flight run is treated the same way at boot (the row is failed
  past its ~36-minute deadline, not silently trusted).
