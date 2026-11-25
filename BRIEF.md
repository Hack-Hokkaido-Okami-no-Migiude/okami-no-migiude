**Hack Hokkaido: Team Brief**

**Okami no Migiude**

Nov 24, 2026 · @Adrien Harrison

# **In short**

Hi everyone, I'm Claude, Adrien's AI advisor. Adrien asked me to pull together everything we've discussed this week into one brief for the team, so here it is.

We're six on the official team: Adrien Harrison, Hikari Igarashi, Seiko Yamaguchi, Ethan Chow, Viji Karuppasamy and Thomas Braam. Koki is our unofficial seventh. Koki's a student who wants to help, isn't registered on the portal, and is very welcome on everything we build.

We're building Okami no Migiude (狼の右腕, "the wolf's right hand"): Leave it to me. It's an AI business check-up for small businesses. An AI agent called Shima Enaga interviews the owner for about 30 minutes, finds out where their hours go, and explores what they could learn from other businesses' use of AI and automation. The owner gets a report and a first automation suited to their work. We lead the demo with family-run onsen inns near Sapporo, starting in Jozankei, because that's where the evidence pointed.

The brief runs in the order we got here. First the story of how we worked through the options, then what we concluded, then the plan, and last a set of questions for each of you about what you can take on. Nothing is assigned until you say yes.

One thing to know about how Adrien works this week: I'm doing the build work that would otherwise sit with him (the workflows, integrations, writing and sign-ups), so he can focus on the team, the pitch and his talk. Where this brief says "Claude", that's me working from Adrien's account.

The team is locked: all six of us are on the portal team with categories A and B saved, so the questions in the last section are the ones that matter now.

# **How we got here**

## **Step 1: we started from something that already works**

Adrien already sells an AI business assessment through his company OpsJuice. A voice agent interviews a small business owner, and AI writes a report on where time and money are lost and what to automate first. Each of us brought a piece that fits around it. Seiko's Revenue CRM turns a conversation into records, tasks and follow-ups. Hikari runs structured interviews with local businesses. Viji teaches AI to owners and students in Sapporo. Ethan builds web and call-centre software. So the question was never what to build. It was who to build it for first.

## **Step 2: we scored ten kinds of Hokkaido business**

We started with dairy and fisheries, because that's where our team had some interest and access. Rather than assume either, we tested them against every plausible Hokkaido niche. Ten candidates were scored the same way on eight measures, each out of 10 (80 total):

- How severe the pain is.
- Adrien's four filters from his customer method: most willing to solve it, most able to pay, wants everything we offer, and tells the most others.
- Whether we can reach a real customer this week.
- Whether it can be built in three days.
- Whether free government data sits at the centre, since that's a quarter of the judges' score.

The research read 312 sources, mostly Japanese government statistics, industry groups and trade press. Small family inns came first with 58\. Dairy was second with 46\.

## **Step 3: why the obvious picks lost**

**Dairy.** The pain is the worst we found: 197 Hokkaido dairy farms quit in a year and only 16 started. But the lost hours go to milking, not paperwork, so our product doesn't fix them. Milk sales and records run through the co-ops (JA and Hokuren) and Farmnote's herd software, so a farmer can't say yes alone. And none of us knows a dairy farmer yet. If one agrees to test our call this week, dairy moves up.

**Fisheries.** The paperwork belongs to co-ops, fish markets and the prefecture, and the national Fisheries Agency is already building a "report once" system, so one fisher buying our tool changes little. Hikari's fisheries network is real, but it's in Kesennuma in Miyagi, not Hokkaido.

**Inns.** The owner decides alone and already pays monthly for software. Bookings and guest messages give us concrete work to explore in the interview. Inns talk to each other through associations. And Jozankei is an hour from where we're sitting.

## **Step 4: Hikari's three documents**

This morning at 08:54 Hikari shared three PDFs: a research briefing on business digitisation in Hokkaido, the Shima Enaga pitch deck ("Hear. Map. Match.") and a 3 minute pitch script. Her research shows why this matters now:

- 65.7% of Hokkaido companies have no successor (Teikoku Databank Sapporo, 2024), the 4th highest rate in Japan.
- 70% want to digitise, but only 18.9% feel it's working.
- 42% have nobody in charge of it, and the most common answer from small firms is "our problems aren't clear yet".
- The money exists: national subsidies cover half to two thirds of automation costs.

Her thesis is that what's missing isn't tools or money. It's someone who listens to how the work actually flows and carves out what to automate. She calls it the listening layer, and Shima Enaga is her version of it: an AI interview (Hear), a map of the hours (Map), and task cards engineers can take on (Match).

That's the same engine as ours. So we decided three things:

1. The inn is the first case of the listening layer. Her horizontal vision, any small company hosted by a town and funded by subsidy, becomes our roadmap. This week it serves one customer, which is what judges score. Her own slide promises one real AI interview with one real Hokkaido company, and an inn interview is exactly that proof.
2. Her build slide stays as it is. It lists ElevenLabs, Dify, OrcaRouter, Linkup, Neo4j and Neon. Our earlier draft left Neo4j out. Adrien's call was that we use every partner tool we can put to real use, so Neo4j is in as the map.
3. Her numbers sharpen the pitch. The succession figure opens it, and "70% want to digitise, 18.9% feel it's working" frames the problem.

## **Step 5: Seiko's point**

Seiko's line: "Events end. This stays." Most tools fail after launch because staff stop using them, not because the software breaks. Hackathon projects are the extreme case. So we build for use, not for the demo. The owner's only job is pressing approve, staff training is part of the product, and the first ten inns get it free in exchange for real use and a referral. That line closes the pitch.

## **Step 6: the partner tools**

The event's partners give prizes for the best use of their tools. Adrien's rule is that a prize is earned by how deeply a tool works inside the product, not by a logo on a slide. Then on Neo4j he pushed further: use as many tools as we can put to real use, because that's how we win. So I checked every partner the same way: what breaks if we take it out? Ten passed and are now built in and tagged. The details are in the partner tools section.

# **Where that leaves us**

## **The customer**

Picture one inn in Jozankei. Fourteen rooms and a hot spring bath. The okami is 61, her husband cooks, and they have two full-time and four part-time staff. Her son, 32, works at a Sapporo hotel and hasn't decided whether he'll take over. She's a composite built from published figures, not a real person, and Wednesday's interviews replace her with real owners.

Hokkaido had a record 13,302,640 foreign guest-nights in 2025, up 29% (Japan Tourism Agency). Keeping up with the admin takes the owner's time. Every evening she copies bookings between booking sites, a paper notebook and her phone. She builds the rota in a spreadsheet and answers guests' booking questions herself. Wednesday's interviews will tell us how much time owners spend on these tasks.

The other half is what happens when she stops. 2,568 Hokkaido businesses closed in 2025 (Teikoku Databank), and about half were still profitable. One correction to earlier drafts: inns' part-time staff shortage is easing (from 59% in October 2025 to about 40% in 2026), so we pitch the owner's lack of time and successor, not a lack of staff.

## **The product, step by step**

The name is Okami no Migiude (狼の右腕), with the subtitle "Leave it to me." 右腕 says what it does: a right hand for the owner. A search found no product or company using it; Kikite was too close to KikitAI, an existing Japanese business chatbot.

**Business discovery (about 30 minutes for the full interview).** The owner starts a live call with Shima Enaga on the website. Shima Enaga opens in Japanese and switches if the owner answers in English. She asks what's been keeping the owner up at night this month, walks through the last time it happened, and asks what they've tried and why it didn't work. She learns who does the work, which tools they use and how much time it takes. Later she asks what fixing it would be worth and whether the owner would pay the proposed price today.

**Research during the call.** Once Shima Enaga confirms the business name, location and type, our server starts a Linkup Research job using [the Linkup research prompt](server/yuki/research-prompt.ts). Linkup looks for sourced examples of digital transformation (DX), AI and automation at comparable businesses and in adjacent industries. Shima Enaga keeps interviewing the owner while the research runs.

**Explore ideas together.** Once Shima Enaga has finished gathering the basic information and the research is ready, she brings up two or three relevant examples, one at a time. She asks how the owner handles that work today and whether anything similar is already in place. If they have a tool, she asks what work remains manual. If an idea is a poor fit, she asks why and follows the owner's answer, which can lead to a different DX idea. Shima Enaga wraps up on time if research is delayed. Results that arrive later can be shared in the report as follow-up material.

**The map and the report.** The interview becomes a map of the inn covering people, tasks, tools, guests, hours and what each task waits on. The report quotes the owner, turns weekly hours into yearly hours, and links to the peer examples. It records what the owner found promising, what would need adapting, and what they ruled out. It ranks the three fixes to do first across the four kinds we can deliver: voice follow-up calls, workflow automations, the customer record system and staff training.

**The records and the first automation.** The inn, the owner, the deal and three follow-up tasks fill themselves in. The first automation addresses a task the owner identifies. The inn demo uses a sample booking. The owner chooses English or Japanese on the web page to preview the check-in draft. Sending a real message requires owner approval.

## **Why it keeps working after Friday**

- Built for use, not the demo: the owner only presses approve.
- Staff training is in the product, and Viji teaches owners and staff to run it.
- The first ten inns get it free for real use, a testimonial and a referral.
- The code is public and the assessment is published as a reusable service, so another town or business type can pick it up.

## **Every niche we weighed, and the order we'd take them**

The engine is the same for any small business; only the vocabulary, the open data and the first automation change. Judges score one named user and one working demo, so we pitch one niche and show the rest as the roadmap.

| Niche                             | Score /80 | Order                | Why                                                                                                                                                           |
| :-------------------------------- | :-------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Small family inns (8 to 30 rooms) | 58        | 1, the demo          | Owner decides alone. Lost hours go to messages, bookings and paperwork. Tourism data gives local context. Fits Track B and the organisers' own hotel example. |
| Ski and tourism operators         | 44        | 2, next              | Similar guest workflows and close to the Jozankei inns                                                                                                        |
| Dairy farms                       | 46        | 3, if a farmer joins | Worst pain, but hours go to milking and records run through JA, Hokuren and Farmnote                                                                          |
| Care and welfare services         | 43        | 4                    | Staffing cliff and paperwork, but resident records and consent make a 2 day demo risky                                                                        |
| Construction and trades           | 43        | 4                    | Quotes and scheduling automate well; winter is their slow season                                                                                              |
| Transport and logistics           | 42        | 5                    | Operators are larger and already run dispatch software                                                                                                        |
| Restaurants and food producers    | 41        | 5                    | Multilingual menus are a clear win, but other teams will likely build it                                                                                      |
| Other farming                     | 41        | 6                    | Seasonal work and co-op owned records                                                                                                                         |
| Fisheries                         | 39        | 6                    | Formats belong to co-ops and markets; our access is in Miyagi                                                                                                 |
| Independent shops                 | 37        | 7                    | Smallest budgets and fewest hours to automate                                                                                                                 |

The pitch says it in one line: "We start with inns in Jozankei. The same interview works for any small business in Hokkaido."

# **The partner tools**

Ten partner tools are built into the product and tagged for their prizes. The test for each one is simple: what breaks if we take it out? Owners below are my proposals, and the questions at the end ask each of you to confirm.

## **How the pieces fit together**

ElevenLabs runs Shima Enaga's live voice session and collects the owner's answers. Shima Enaga appears on the call screen as a 3D character made in Hyper3D Rodin and animated in Cascadeur.

During the call, an ElevenLabs webhook tool sends the confirmed business details to our server. The server starts the Linkup job, returns promptly, and polls for the result in the background. The website passes short, sourced examples back into the live ElevenLabs session as a contextual update. Shima Enaga can use them on later turns without interrupting the conversation.

When the call ends, ElevenLabs sends the transcript to our server, which stores it in Neon and starts the Dify assessment. Inside Dify, CarbonForge sorts the answers and pulls out hours and yen. OrcaRouter writes the report using the interview, available Linkup cases and cached tourism statistics, with personal details masked.

Neo4j turns the interview into the map of the inn and ranks the top three fixes.

Adaption Labs gives us a labelled set of synthetic inn interviews, so we can test that extraction is right before real owners call.

The report and records go back into Neon, and the screen shows them filling in. The inn demo previews the check-in drafts in the browser. A Dify workflow can run the first automation when we connect the business's systems.

## **Summary**

| Tool          | What it does in our product                                                       | Prize if we win                    | Proposed owner                         |
| :------------ | :-------------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------- |
| ElevenLabs    | Shima Enaga's live voice, listening, and collected answers                        | Scale plan, 3 months each          | Thomas (phone line), Hikari (Japanese) |
| Linkup        | Sourced DX case studies from similar businesses for the live interview and report | US\$250 cash \+ US\$250 credits    | Thomas                                 |
| Dify          | Assessment report and automation workflows for connected business systems         | Dify Cloud 12, 6 or 6 months       | Claude, with Seiko on task wording     |
| Neon          | Every record, a resettable demo copy, open data cache                             | US\$1,000 credits                  | Seiko (structure), Claude (connection) |
| ~~Neo4j~~     | ~~The map of the inn and the top three ranking~~                                  | ~~Aura credits US\$300, 200, 100~~ | ~~Ethan~~                              |
| OrcaRouter    | Model routing, personal-data masking, fallback; Shield on the site                | US\$250                            | Claude, Ethan (Shield)                 |
| CarbonForge   | Fast sorting of answers into hours and yen                                        | Fast model access to 28 Feb 2027   | Claude                                 |
| Adaption Labs | Synthetic labelled interviews to test extraction                                  | US\$1,000 each                     | Thomas                                 |
| Hyper3D Rodin | Shima Enaga as a 3D character                                                     | Partner prize                      | Koki, with Thomas                      |
| Cascadeur     | Shima Enaga's greeting, listening and bow animation                               | Partner prize                      | Koki, with Thomas                      |

## **Each tool in a few lines**

**ElevenLabs.** Shima Enaga is an ElevenLabs conversation agent that uses the Yuki voice and a Japanese prompt. Its data collection fields capture the business name, location and type, plus rooms, staff, pain points, hours, yen, tools they've tried, succession and the exact price answer. Its evaluation checks confirm all five questions were asked and that Shima Enaga uses the peer examples once the basics are covered and research is available. Claim the personal coupon ElevenLabs emailed on 21 November while signed in at elevenlabs.io.

**Dify.** The assessment combines the interview, available Linkup findings and cached tourism statistics into the report. We also publish the assessment as an MCP server so other tools and towns can reuse it. Claim one workspace code at team forming tonight at the venue. We keep a prepared report as backup for the demo.

**Neon.** A Postgres database that holds owners, calls, masked transcripts, reports and records. Branching gives us a clean demo copy reset before every rehearsal, and AI search lets the report say "inns like yours most often fixed this first". Claim: free plan at neon.com.

**Neo4j.** The interview becomes a graph: owner and staff, each task, the tool or paper it runs on, the guests it touches, the hours it costs and what it waits on. The "fix these three first" ranking is a graph query, and the map draws itself on screen as the owner talks. Claim: free AuraDB at console.neo4j.io; save the password it shows once. Working by Wednesday evening.

**Linkup.** We use the Research API to find practical examples of AI, automation and DX at similar businesses. We start with the shorter `S` reasoning depth, which Linkup estimates at roughly 2–5 minutes, and check in rehearsals that it returns enough relevant, cited examples. See the [Linkup Research documentation](https://docs.linkup.so/pages/documentation/endpoints/research/overview). Claim US\$50 off at app.linkup.so with the event code HOKKAIDO50.

**OrcaRouter.** Every report and guest message goes through it with the personal-information and prompt-injection guards on, plus a fallback chain if one model is slow. Shield protects our public demo site; switch it on Wednesday evening so the 5 to 7 day trial covers judging. Claim: the redeem link in the perks email.

**CarbonForge.** A very fast model that sorts the owner's answers into categories and pulls out every hour and yen figure, so the report appears within seconds on stage. Keys stop working Friday 27 November at 11:59 PM. Open question: the portal describes its prize as "carbon calculators and lifecycle tools", a different product, so we confirm with Andrew or Eva which one is judged.

**Adaption Labs.** We only have a handful of real interviews, so we generate a labelled set of synthetic Japanese inn-owner interviews from published figures and test our extraction step against it. If time allows, we train a small extraction model on it. Every synthetic interview is labelled synthetic. Credits US\$500 each.

**Hyper3D Rodin and Cascadeur.** Rodin makes Shima Enaga as a 3D character; Cascadeur animates her greeting, listening and bow, exported as a web file the call screen plays while she speaks. It gives the call a face, which is the human touch the pitch score asks for. We keep it to that one character. Redeem the Hyper3D code from today's email (check Promotions or Spam).

## **Claimed as extras, not tagged**

- Hermes (Nous Research): a backup model behind OrcaRouter if another provider fails on stage. No prize to tag.
- quotum: one capped team key (US\$15, valid to 28 November), our emergency AI budget. Claimed in quotum's Discord.
- PixVerse: a few seconds of inn footage for our video. Redeem at pixverse.ai by 1 December.
- TypeSafe: one key to the team lead once teams are final. Not used this week.

## **Left out**

- Fish Audio: no perk or prize this week, and ElevenLabs already does Japanese voice.
- Google AI Studio, Cloudflare Workers AI, Jina, Voyage: welcome, but no prizes, and they'd do nothing the tagged tools don't.
- La Terra challenge: a farming challenge, not our product.

## **Open data (a quarter of the score)**

- Japan Tourism Agency guest-night statistics: the report's "demand is at a record" section.
- Health ministry inn counts (2,930 inns and hotels in Hokkaido): context in the written description.

# **The event: deadlines, rules and how we're judged**

## **The times that matter**

| When                | What happens                                                                                                          |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| Tue 24 Nov, 10 PM   | Team lock. Complete: all six of us are on the portal team, categories A and B saved. Koki stays an unofficial helper. |
| Thu 26 Nov, 2 PM    | Code freeze. Repo link, categories, team list and partner tags all lock. Repo public with the MIT licence.            |
| Thu 26 Nov, 2:30 PM | Final deadline. Pitch, written description, video (3 minutes or less) and deck uploaded, status "Submitted".          |
| Thu 26 Nov, 4 PM    | Demo Night at HooK 4F.                                                                                                |
| Fri 27 Nov, 1 PM    | Awards at The lounge by WeWork.                                                                                       |

The six names on the portal team list at code freeze decide who shares any prize.

## **Rules for every prize**

- Public repo, MIT licence file in the top folder, a README that explains how to run the demo, and no secrets or personal data in the code.
- Only this week's work is scored. Anything reused, such as OpsJuice prompt patterns, goes under "Prior work".
- A partner's tag must be on the project before Thursday 2 PM.
- Every team member signs up to our categories in the portal before code freeze, and signs the consent form.

## **How we're scored**

The portal gives four criteria at 25% each: Impact in Hokkaido, Use of open data and AI, Prototype quality, and Pitch and story. The kickoff slides say judges score the video, written description and slides rather than the code. Adrien checked with the organisers, and our final is a 3 minute pitch plus a 3 minute demo. So we make both strong, and we show every partner tool in three places: in the product, on one "How it's built" slide, and in a README and written description section called "Partner tools and how deeply we use them".

| Criterion               | How we score                                                                                                                                   | Tools carrying it                                                       |
| :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| Impact in Hokkaido      | A named user, a measured problem, and a next step through Jozankei's tourism association and the Hokkaido inns association (about 800 members) | Linkup, Neo4j                                                           |
| Use of open data and AI | Tourism statistics give the report local context. AI interviews the owner, researches peer examples, maps the work and writes the assessment.  | ElevenLabs, Dify, CarbonForge, OrcaRouter, Linkup, Neo4j, Adaption Labs |
| Prototype quality       | The whole chain works live with backups                                                                                                        | Neon, OrcaRouter, ElevenLabs                                            |
| Pitch and story         | One owner, a face on the call, and a recurring task taken off her plate                                                                        | ElevenLabs, Rodin, Cascadeur                                            |

## **Categories**

The pitch focuses on Track B, "Fewer hands, same town". Tracks A and B are currently saved in the portal.

# **The pitch and the demo**

## **The pitch (3 minutes)**

Adrien delivers it. I draft the script with Hikari, merging her Shima Enaga script with this one: inn first, roadmap last.

**0:00 one person.** "After the last guest checks in, an okami in Jozankei still has to copy bookings into her notebook, answer guest messages and make the staff rota. She runs a 14-room inn. She's also its reservations desk and office manager." (A composite until Wednesday's interviews give us a real one.)

**0:25 the problem.** Nearly two in three Hokkaido companies have no successor. 70% want to digitise, but only 18.9% feel it's working. Small inns don't die from lack of guests; they die from an owner out of hours with no successor.

**0:55 why now.** Japanese voice AI got good this autumn, and subsidies covering up to two thirds of automation costs are open right now.

**1:20 the insight.** "Everyone is building AI that answers guests. The okami needs someone to ask where her nights go, then fix one thing this week." We built the listening layer.

**1:45 the product.** Cut to the demo.

**2:15 how it spreads.** Inns are organised, and one okami who saves 500 hours a year tells the next. "We start with inns in Jozankei. The same interview works for any small business in Hokkaido."

**2:35 the team.** One line each, only claims we can prove.

**2:50 the ask and close.** "Introduce us to 10 inns in Jozankei. We'll run their assessments free." Then: "Events end. This stays."

Two facts from Hikari's slides need checking against their sources before they go on stage: the OpenAI OpenWorks figure and the 974 funded local governments. If either can't be confirmed, it comes out.

## **The demo (3 minutes)**

**0:00** "Hikari is playing a 61-year-old okami. The inn's details are fictional and labelled on screen. The interview and workflow are live."

**0:10 to 1:40 Live call.** 3D Shima Enaga asks the owner to walk through a recurring task in Japanese, with live captions. Shima Enaga then discusses two cited peer examples from clearly labelled, pre-run Linkup results and adapts one to the owner's answer.

**1:40 The call ends.** The screen shows the transcript, then the Dify assessment as it sorts the answers with CarbonForge and writes the report with OrcaRouter.

1:55 The map draws itself (Neo4j) and the top three fixes light up.

2:15 The report shows her words, her hours as a yearly number, the cited DX examples and which idea she wants to try.

**2:35 The records fill themselves (Neon).** Seiko clicks English and Japanese to preview both versions of a check-in draft for a sample booking.

2:55 "Assessment today, first automation this week."

**Backups.** Venue internet fails: Ethan's phone hotspot. Voice call fails: replay a recorded Wednesday call through the live pipeline. Report too slow: show the prepared report, labelled as prepared. A model fails: OrcaRouter's fallback answers. Ethan picks the backup within five seconds so there's no silence on stage.

## **What isn't proven yet**

- None of us has a confirmed relationship with an inn yet. That's the single biggest risk.
- Every hours figure and price is an estimate until Wednesday's interviews. If fewer than half of owners say yes to the price question, or their paperwork is under five hours a week, we re-score the niches with real numbers that day.
- The organisers' own example challenge for Track B is a hotel operations agent, so other teams may build something close. Our difference is the owner interview and the automation we deliver.
- We haven't measured Japanese speech recognition on older voices and regional accents. The noisy-room test and real calls will tell us.
- Which CarbonForge product the prize judges is still open.
- If ElevenLabs' Japanese fails badly, Adrien's own free voice route is the fallback, and we drop the ElevenLabs tag only as a last resort.

## **Test prices after the event**

| Step                         | Price                            | Why                                                                 |
| :--------------------------- | :------------------------------- | :------------------------------------------------------------------ |
| Pilot, first 10 inns         | Free                             | For a recorded testimonial and an introduction to another inn       |
| Assessment (call and report) | 33,000 yen (about US\$220)       | Less than one night's revenue from two guests                       |
| First automation build       | 198,000 yen (about US\$1,320)    | A national subsidy can cover two thirds of eligible costs           |
| Customer record system       | 9,800 yen a month (about US\$65) | Between the cheapest site controller (5,500 yen) and bigger systems |
| Training                     | 55,000 yen a session             | Viji's and Adrien's existing course format                          |

We never promise an owner a subsidy; the local chamber of commerce confirms eligibility. Every price is a test, and Wednesday's fifth question confirms or kills it.

# **The plan by day**

These are proposals. Each name is who I think fits best; the next section asks each of you to confirm. Everything that would have sat with Adrien is mine, so he's free for the team, the pitch and his talk.

## **Tonight**

| \#  | Task                                                                                                                        | Proposed                            |
| :-- | :-------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| 1   | Confirm the six of us with Martin. Done: all six are on the portal team, categories A and B saved.                          | Claude, plus whoever's at the venue |
| 2   | Pick up the Dify workspace code at team forming and post it in the group; Claude sets up the workspace and invites the team | Whoever's at the venue, then Claude |
| 3   | Each of us: redeem the ElevenLabs coupon, save the CarbonForge key, open the OrcaRouter redeem link, sign the consent form  | Everyone on the team                |
| 4   | Each of us: tick categories A and B in the portal                                                                           | Everyone on the team                |
| 5   | Claim Linkup with HOKKAIDO50, set up Neon and Neo4j accounts                                                                | Claude, Ethan (Neo4j)               |
| 6   | Claim the quotum team key in quotum's Discord                                                                               | Ethan                               |
| 7   | Ask Andrew or Eva which CarbonForge product the prize judges                                                                | Claude                              |
| 8   | Redeem the Hyper3D code and Adaption Labs credits                                                                           | Koki, Thomas                        |

## **Tuesday night to Wednesday midday (the integrations)**

| \#  | Task                                                                                                                                 | Proposed          |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------- | :---------------- |
| 9   | Dify assessment workflow end to end with CarbonForge sorting, sourced Linkup cases, cached tourism statistics and OrcaRouter writing | Claude            |
| 10  | Record structure in Neon, a demo branch with one-click reset, open data cache                                                        | Seiko             |
| 11  | The inn graph in Neo4j and the top three ranking query                                                                               | Ethan             |
| 12  | ElevenLabs website session, phone number, call speed, live research handoff and end-of-call webhook                                  | Ethan             |
| 13  | Japanese script and pronunciation check for inn words                                                                                | Hikari            |
| 14  | Synthetic labelled interview set in Adaption Labs, and an extraction test against it                                                 | Thomas            |
| 15  | 3D Shima Enaga in Rodin, animated in Cascadeur, playing on the call screen                                                           | Koki, with Thomas |
| 16  | Phone Jozankei and Sapporo inns: five or more owners booked for Wednesday                                                            | Viji, Hikari      |
| 17  | Retarget Hikari's hook and demo slides to the inn                                                                                    | Hikari            |

## **Wednesday**

| \#  | Task                                                                                                              | Proposed       |
| :-- | :---------------------------------------------------------------------------------------------------------------- | :------------- |
| 18  | Real owner interviews; record exact words and the price answer                                                    | Hikari, Viji   |
| 19  | One real inn interview with written consent for a screenshot and one quote                                        | Seiko, Hikari  |
| 20  | Fix the product from what owners say; freeze the interview script at 5 PM                                         | Claude, Ethan  |
| 21  | Check-in draft demo with a sample booking and English and Japanese buttons                                        | Claude, Seiko  |
| 22  | Publish the assessment as a reusable MCP service                                                                  | Claude         |
| 23  | "Partner tools and how deeply we use them" in the README and written description, plus the "How it's built" slide | Claude, Seiko  |
| 24  | Merge the pitch scripts into one 3 minute script                                                                  | Claude, Hikari |
| 25  | Confirm the OpenWorks and 974 figures from their sources, or cut them                                             | Hikari         |
| 26  | Switch on OrcaRouter Shield for the demo site (evening)                                                           | Ethan          |
| 27  | Record the 3 minute video, showing each tool at work                                                              | Claude, Ethan  |

## **Thursday**

| \#  | Task                                                                           | Proposed                  |
| :-- | :----------------------------------------------------------------------------- | :------------------------ |
| 28  | Final written description with real owner quotes                               | Claude, Seiko             |
| 29  | Two full rehearsals (pitch plus demo) and a backup drill                       | Everyone, Adrien on stage |
| 30  | By 2 PM: repo public, MIT licence, README, all ten tags set, team list correct | Ethan                     |
| 31  | By 2:30 PM: video, written description and deck uploaded, status "Submitted"   | Claude                    |

If my usage runs short this week, Ethan is the backup for tasks 9, 20 and 21, in that order.

# **What I'm asking each of you**

Please answer in the WhatsApp group as soon as you can. A "yes", a "no" or "yes, but" are all useful. If anything in the story above looks wrong to you, say so now while it's cheap to change.

Our name is settled: Okami no Migiude, subtitle "Leave it to me." Kikite was dropped because it is one letter off an existing Japanese AI product in the same space.

Everyone on the team (six of us): can you do tasks 3 and 4 tonight: redeem your ElevenLabs coupon, save your CarbonForge key, open the OrcaRouter link, sign the consent form, and tick categories A and B?

## **Hikari:**

- Can you check the Japanese in Shima Enaga's interview script and the pronunciation of inn words by Wednesday midday?
- Can you retarget your hook and demo slides to the inn, keeping slide 5's tool line as it is?
- Would you work with me on merging your script into one 3 minute pitch by Wednesday evening?
- Can you confirm the OpenWorks and 974 figures from their source pages by Wednesday evening?
- Do you have any inn, association or city contact in Hokkaido you could reach this week?
- Are you happy to play the okami in the demo?

## **Seiko:**

##

## **Can you own the record structure in Neon, with a demo branch we can reset?**

##

## **Can you shape the follow-up task wording and the approve-then-send step?**

##

## **Can you help Hikari book the one real inn interview with written consent?**

##

## **The pitch says you built customer systems at Moloco and Alibaba. Is that right to say on stage?**

##

## **Ethan:**

- Can you own the ElevenLabs phone line, call speed and the end-of-call webhook?
- Would you take Neo4j, the inn map and the ranking query?
- Can you own the stage backups, Shield on Wednesday evening, and the code freeze checklist?
- Could you claim the quotum team key in their Discord tonight?
- If my usage runs short, could you be the backup on the Dify workflows?

## **Viji:**

- Can you lead the phoning list, with five or more Jozankei or Sapporo inn owners booked for Wednesday interviews? This matters more than anything else in the brief, because it turns our estimates into real answers.
- Would you shape the staff training piece of the product, since that's your course format?

## **Thomas:**

- Welcome to the team. Would you take Adaption Labs: the synthetic labelled interview set and the extraction test?
- Could you work with Koki on 3D Shima Enaga?
- If there's something you'd rather own, tell us what you're best at and we'll fit it in.

## **Koki:**

- Thank you for helping. Would you like to build 3D Shima Enaga: the character in Hyper3D Rodin and her greeting, listening and bow in Cascadeur?
- Since you're not on the portal list, you won't share in prizes, but we'll credit you in the README and on our closing slide if you're happy with that.

Adrien: can you deliver the pitch and the demo on stage, and be the one at the venue tonight who confirms the team with Martin and picks up the Dify code? I'll do the rest of what used to sit with you.

From me (Claude), tonight: the email to Martin, the Linkup and Neon sign-ups, the question to Andrew or Eva about CarbonForge, and starting the Dify assessment workflow.

# **Words used in this brief**

**Okami:** the woman who runs a traditional Japanese inn, usually the owner or the owner's wife.

**Ryokan, minshuku, pension:** a traditional inn; a smaller family guesthouse; a small Western-style family lodge.

**Onsen:** a natural hot spring bath. Jozankei is a hot spring town about an hour from central Sapporo, with roughly 20 small inns.

**Portal:** portal.hackhokkaido.com, where we register the team, pick categories, add partner tags and submit.

**Partner, perk, tag:** a company backing the event; the free access it gives us; the label on our project that makes us eligible for its prize. Tags lock Thursday at 2 PM.

**API key:** a secret code that lets our software use a partner's tool. Never paste one into chat, email, screenshots or public code.

**Public repo and MIT licence:** our code published on GitHub where anyone can read it, with a standard file saying anyone may reuse it. Every prize requires both.

**Open data:** information the government publishes free. We use Japan Tourism Agency guest-night statistics and health ministry inn counts for context.

**Voice agent:** an AI that holds a live spoken conversation. Ours is Shima Enaga.

**Workflow:** a fixed chain of steps a computer runs in order.

**Graph database:** a database that stores things and the links between them, which is what the inn map needs.

**Synthetic data:** made-up but realistic examples, built from real published figures and always labelled as made up.

**Webhook:** an automatic message one service sends another the moment something happens.

**Yen:** in this brief US\$1 is roughly 150 yen.
