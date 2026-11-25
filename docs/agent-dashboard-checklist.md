# Manual dashboard checklist — updating Shima Enaga

Everything below is applied by hand in the ElevenLabs dashboard
(elevenlabs.io → **Agents** → Shima Enaga → **Edit**). The two payload files
are already written and generalized:

- `docs/agent-system-prompt.md` — copy everything between the
  `PROMPT BEGIN` / `PROMPT END` markers (step 1).
- `docs/agent-knowledge-base.md` — upload as the knowledge-base document (step 3).

API push was abandoned (the API key could not be authenticated), so this
checklist replaces the automated push. Apply in order; skip anything already
set to the target value.

## 1. System prompt (Agent → Prompt)

Replace the entire system prompt with the `PROMPT BEGIN`…`PROMPT END` block
from `docs/agent-system-prompt.md`. It contains the generalized spine (Parts
A + E), the runtime-generic industry intake that replaces the ten Part B
modules, time rules, research-handoff rules, guardrails, and the pre-close
completeness check.

Notes:

- The prompt reads the business context from `{{web_business_context}}`
  (the variable the web app actually passes) — do not replace it with
  `{{business_name}}`-style variables; those do not exist at runtime.
- Target size is ~2,000 tokens; the probe depth lives in the knowledge-base
  document, not the prompt.

## 2. First message

The first message is templated by the platform and cannot read values out of
the `web_business_context` JSON, so use the variable-free opening:

```
こんにちは。シマ エナガと申します。はじめにお伝えします。私は人ではなく、AI、つまりコンピューターの声です。今日は、お仕事の流れを15分ほど伺って、あなた専用のレポートをお作りします。販売のお電話ではありません。
```

The consent question (「録音してよろしいですか」) comes as the agent's second
turn, driven by the prompt.

## 3. Knowledge base (Knowledge base tab)

1. Upload `docs/agent-knowledge-base.md` as a new knowledge-base document.
2. Attach it to this agent and leave knowledge-base retrieval (RAG) enabled.

## 4. Conversation settings (Settings tab)

| Setting                                    | Value                                                                       | Why                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Max call duration (`max_duration_seconds`) | **1200** (user set **2100** on 2026-11-26 — also fine, extra headroom)      | The default 600 s cuts a 15-minute interview mid-question                                                                                          |
| Turn eagerness                             | **Patient**                                                                 | Waits longer for older/thinking speakers                                                                                                           |
| Turn timeout                               | **8–12 s**                                                                  | Short values cut off owners who pause to think                                                                                                     |
| Soft timeout                               | **3 s**, filler 「はい、少々お待ちください。」                              | The default filler is English ("Hhmmmm...yeah.")                                                                                                   |
| Interruptions                              | **On**                                                                      | Owners must be able to barge in                                                                                                                    |
| Language detection                         | **On**, presets `ja` (primary) + `en`; "only at conversation start" **off** | The agent opens in Japanese and switches when the owner answers in English; leave the start-only switch off unless loanwords cause false switching |

## 5. Data collection (Analysis → Data collection)

Keep existing field IDs; only the descriptions change (they are what the LLM
sees). The generalized descriptions for all 25 fields:

| #   | Field                    | Type    | Description                                                                                                                                                          |
| --- | ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `consent_recording`      | boolean | True only if the owner gave a clear yes (はい／いいですよ／どうぞ) to recording before any interview question.                                                       |
| 2   | `consent_quote`          | boolean | True only on a clear yes to anonymised quoting. Null if not asked.                                                                                                   |
| 3   | `language_used`          | string  | "ja", "en" or "mixed".                                                                                                                                               |
| 4   | `business_type`          | string  | Free text: what the business does, in the owner's own words; fall back to the sign-up category. No fixed enum.                                                       |
| 5   | `size_metric`            | string  | The business's own size measure with unit, as stated (rooms, seats, vehicles, animals, hectares, staff count…).                                                      |
| 6   | `staff_breakdown`        | string  | Format "family=N; fulltime=N; parttime=N; seasonal=N; foreign=N". Null for each part not stated.                                                                     |
| 7   | `successor_status`       | string  | One of: decided, candidate_undecided, none, skipped.                                                                                                                 |
| 8   | `decision_maker`         | string  | Who approves changes to tools and ways of working (owner alone, owner + spouse, head office, association, co-op, prime contractor, municipality…).                   |
| 9   | `task_list`              | string  | JSON array from the day walk-through: {task, who, tool_or_paper, minutes_each, times_per_week, touches, waits_on}. Use the owner's words for the task.               |
| 10  | `top_task`               | string  | The task the owner confirmed takes the most time.                                                                                                                    |
| 11  | `top_task_hours_week`    | number  | Decimal hours per week for top_task, as read back and confirmed. Convert 分 to hours. Null if not confirmed.                                                         |
| 12  | `admin_hours_week_total` | number  | Total weekly admin hours as read back and confirmed; null if not confirmed.                                                                                          |
| 13  | `hours_confidence`       | string  | How the hours were obtained: stated, decomposed, bracket, landmark, or unknown. Add "range:2-3" if a range was given (store its midpoint in the number fields).      |
| 14  | `critical_incident`      | string  | One specific hard day: when, what happened, who was involved, total hours, consequence. "none recalled" if none.                                                     |
| 15  | `seasonal_peak`          | string  | Busiest and worst periods, as stated, with hours if given.                                                                                                           |
| 16  | `tools_and_paper`        | string  | All tools, software, paper forms and outside services named, with monthly cost if stated.                                                                            |
| 17  | `tried_before`           | string  | Changes tried, whether still used, the reason stopped in the owner's words; "never_looked" if none.                                                                  |
| 18  | `value_in_owner_words`   | string  | What the owner would do with the time back (soft, hypothetical).                                                                                                     |
| 19  | `monthly_spend_now_yen`  | integer | Current monthly spend on the work's tools and services. Convert 万/千 to integer yen (3万5千円 → 35000).                                                             |
| 20  | `wtp_monthly_yen`        | integer | The owner's stated would-pay per month. Low confidence. Null if declined, 考えておきます, or not asked.                                                              |
| 21  | `payer`                  | string  | Who would pay: the business, a co-op, head office, or other.                                                                                                         |
| 22  | `email_for_report`       | string  | Written form, lowercase, no spaces; the registered email unless the owner gave another.                                                                              |
| 23  | `email_confirmed`        | boolean | True only after a full read-back and a clear yes.                                                                                                                    |
| 24  | `opt_ins`                | string  | Format "updates=yes/no; referral=<name or none>".                                                                                                                    |
| 25  | `review_flags`           | string  | Any of: distress, sensitive_info_mentioned, staff_answered, second_person, noise, misheard_numbers, notes_only_followup, stopped_early, english_switch, wants_human. |

Non-Trial, non-Enterprise plans allow at most 25 fields (50 on Trial and
Enterprise) — drop optional ones (20, 21, 24) first if the agent is at the cap.

## 6. Evaluation criteria (Analysis → Success evaluation)

Twelve criteria; each returns success, failure or unknown.

| Criterion                          | Success means                                                                                            | Failure means                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ai_disclosed_first`               | The first agent turn says it is an AI.                                                                   | Any question before disclosure, or any claim or implication of being human.             |
| `consent_before_content`           | A clear yes to recording before the first business question.                                             | A business question after silence, an ambiguous answer, or a no.                        |
| `no_price_quoted`                  | No yen amount or price range given for our service. Quoting the owner's own figures back is fine.        | Any statement of what our service, assessment or automation costs.                      |
| `no_subsidy_promised`              | Subsidies mentioned only as "I can't promise; please check with the chamber of commerce" or similar.     | Any statement that the owner will or likely will get a subsidy, grant or specific rate. |
| `no_finding_promised`              | No promise of a specific saving or recommendation.                                                       | E.g. "the report will show you can save 10 hours".                                      |
| `email_read_back_confirmed`        | A spoken email address was read back in chunks and confirmed; the registered address needs no read-back. | A spoken address not read back, or read back without confirmation.                      |
| `money_asked_last_with_permission` | Money questions came after permission and after the hours questions.                                     | Money asked early or without asking permission.                                         |
| `skips_respected`                  | A declined question is not asked again in the same form; 「ちょっと…」 is treated as a no.               | A declined question is pressed a second time.                                           |
| `one_question_per_turn`            | No agent turn asks two different questions.                                                              | Any double-barrelled turn.                                                              |
| `language_matched`                 | The agent switched to English when the owner answered in English, and back if asked.                     | It kept speaking Japanese to an English-speaking owner, or switched on a loanword.      |
| `no_sensitive_details_collected`   | No names or health details of residents, clients, patients or staff were requested.                      | The agent asked for or followed up on them.                                             |
| `distress_handled`                 | On distress, the agent acknowledged it, stopped probing and offered a pause or stop.                     | It continued questions about the distressing event.                                     |

## 7. Optional polish

- **Pronunciation dictionary** (alias rules): only for names the voice
  misreads; alias tags, not phoneme tags.
- **Keyterms** (if selectable for agent ASR): business-type vocabulary,
  booking-site names, common email domains (gmail.com, yahoo.co.jp,
  docomo.ne.jp, ezweb.ne.jp, i.softbank.jp).
- **TTS numbers**: write money and hours in the agent's text as kanji/kana
  (「三万五千円」「にじゅうさんじかん」) — the prompt's read-back lines already
  do this; keep it that way if you edit wording.
- **Voice**: calm, mid-pitched, no background music.

## 8. Verify

1. Save everything, then start one `/voice` call from a synthetic owner
   profile in the app: confirm the AI disclosure + recording consent comes
   first, the interview follows the spine, and the call survives past 600 s.
2. Check the post-call transcript: data-collection fields populated,
   `review_flags` sane.
