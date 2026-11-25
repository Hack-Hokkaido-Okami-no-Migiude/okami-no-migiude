# Okami no Migiude project overview

Okami no Migiude is a bilingual web app designed for a municipal operator to help local small businesses understand how their work gets done and where they could save time. A business owner signs up, completes the **Shima Enaga** interview, and receives a private report. If they want help acting on it, they can ask a human advisor to walk through the recommendations.

The Hack Hokkaido demo follows a family-run onsen inn in Jozankei. The same signup, interview, and report journey is intended to work for other small businesses. Shima Enaga takes its name and bird mascot from the Hokkaido long-tailed tit. The team brief uses **狼の右腕** for the Japanese project name.

## People and responsibilities

| Role                      | What they do                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business owner            | Creates an account, starts the browser interview, reads and downloads their own report, and decides whether to request a consultation.               |
| Designated platform staff | Receive a notification when a report is ready and can review it immediately. Designated staff can also see consultation requests.                    |
| Advisor                   | Talks through the report with an owner who requests help, discusses questions or changes, and may introduce a suitable local implementation partner. |
| Implementation partner    | May help the business carry out a recommendation after an introduction. The owner decides whether to work with them.                                 |

## Website and signup

The homepage explains what the assessment does and has a prominent signup button. Returning owners can sign in with their email and password. The website offers a Japanese and English language selector, with translations organized so more languages can be added later.

| Signup field                   | Expected behavior                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner name                     | Required.                                                                                                                                                                                                                |
| Email                          | Required. Used for sign-in and the report-ready notification.                                                                                                                                                            |
| Business name                  | Required.                                                                                                                                                                                                                |
| Municipality                   | Required. The city, town, or village where the business is located. Use **Sapporo City (札幌市)** for the Jozankei inn. Other examples are Otaru City (小樽市), Niseko Town (ニセコ町), and Akaigawa Village (赤井川村). |
| Account password               | Required, at least 8 characters. Used for sign-in.                                                                                                                                                                       |
| Contact phone number           | Optional. For contact details.                                                                                                                                                                                           |
| Business website               | Optional.                                                                                                                                                                                                                |
| Task the owner wants help with | Optional short note.                                                                                                                                                                                                     |
| Profile language               | Required choice between Japanese and English. Sets the language of the report and its ready email.                                                                                                                       |

Account creation needs the four required fields plus a password, and interview startup needs no further details. After signing up, the owner can start the interview whenever they are ready.

## User journey scorecards

- The [owner journey scorecard](scorecards/owner-journey-scorecard.md) covers signup, consent, the browser interview, report delivery, and the consultation request.
- The [staff and advisor journey scorecard](scorecards/staff-journey-scorecard.md) covers the ready notification, immediate report review, access checks, and optional follow-up.

## Interview and report

### Browser interview

Before capture begins, the website explains the Shima Enaga interview and asks the owner to consent to the recording and transcription handling, the automated report processing, and staff access. Microphone capture is optional and begins only after the owner consents and starts it.

Shima Enaga leads the interview about the business’s day-to-day work. The interview runs through the ElevenLabs Conversational AI agent embedded on the interview page, and the agent handles the entire voice conversation. When the agent is not configured for the deployment, the page falls back to the labeled scripted sample interview: the dialogue is fixed, the owner can edit the transcript before submitting, and optional microphone recording stays local (no automatic transcription, nothing uploaded). The interview should uncover the people and tools involved, manual tasks, bottlenecks, and what happens when a routine changes. The owner can finish early by ending the agent call. The interview and the agent conversation stop at a maximum of one hour.

The interview teammate owns the voice agent, interview questions, and research integration; the teammate’s live research is not connected in this build, and when connected the agent will use a research endpoint for domain context so it can ask better follow-up questions. With the embedded agent, the completed conversation reaches the website through the post-call transcription webhook (HMAC-verified, server-to-server) and is associated with the owner account to trigger report generation; the webhook delivery must arrive even when the owner has already left the interview page. The labeled demo transcript is submitted through the same interface, so both modes associate the interview with the correct owner account and trigger report generation. The agent’s language follows the owner’s website language; confirm supported interview languages with the interview team.

### Report preparation

Once the interview is complete, the system automatically analyzes the interview and prepares the report. Processing can continue after the owner leaves the website. When they return, the site distinguishes a report that is still being prepared from one that is ready. If processing fails, the site shows that the report is unavailable and sends no report-ready email.

### Private report and email

The report helps the owner decide which changes to make first. It covers:

- **Current workflow.** A visual map of how the work gets done today. Show the main steps, handoffs, tools, and where repetitive work or delays take time.
- **Recommended changes.** Rank practical ways to simplify or automate the work. When a recommendation changes the process, show a diagram of the proposed workflow alongside the current one.
- **Effort and cost.** Show time spent today, potential time saved, estimated implementation effort, and indicative cost. Explain the basis for estimates, distinguish what the owner reported from assumptions, and call out gaps that affect the estimate.
- **Implementation options.** Where useful, give one or two ways to make a change. These may use existing tools, a custom solution, or a combination. Explain what the owner would have to set up and what the option would change.

The owner receives one email when the report is ready. It links to the private report on the website. After signing in, the owner can view and download their report and choose whether to share the downloaded copy. The link preserves the report’s access controls, including for downloads. A signed-out visitor needs to sign in, and another business owner cannot open that report.

## Report access and privacy

The owner and designated staff use authenticated access. Staff-only views and actions require staff access. The MVP report is private. Using a real interview quote or screenshot in the pitch is a separate permission decision.

## Demo scenario

Use a family-run inn in Jozankei. The owner checks several booking platforms, copies reservations into a calendar, and uses that information to decide which rooms need cleaning and when. The report can show the existing workflow, then compare it with a shared booking calendar that helps the owner coordinate cleaning. An existing booking tool and a custom extension are examples of options the report could discuss. The demo shows how the owner would evaluate the options and ask for help.

Use the owner and staff scorecards for the integrated walkthrough. Label any test substitute used during the walkthrough. Record which integrations were verified live.

## MVP boundaries and open decisions

The website MVP ends with the private report and optional human follow-up. Phone interviews, a 3D avatar, CRM, live weather or transit feeds, and execution of recommended automations sit outside the website MVP. Coordinating cleaning, for example, is a report recommendation. The owner makes staffing decisions.

A public engineer board is a high-priority stretch goal after the owner and staff paths work. The MVP matching step is the advisor’s optional introduction to a local implementation partner.

Implementation decisions include how email-based sign-in works, the staff notification channel, and how the report is generated. Japanese and English are required for the website. The voice service interface is decided: the ElevenLabs Conversational AI agent embedded on the interview page, delivering transcripts through the post-call webhook. Confirm the agent's supported interview languages with the interview team. Confirm the generated report language before making delivery claims.

## Delivery and verification

The website work can be divided into signup and localization, browser interview integration, report generation and delivery, and staff review and follow-up. The lead agent owns the interfaces between those areas and verifies the merged app through the owner and staff journeys.

Follow the repository conventions in [AGENTS.md](AGENTS.md). Use the [MVP success criteria and agent scorecards](scorecards/mvp-success-criteria-and-agent-scorecards.md) for assignment checks, evidence, and final acceptance.
