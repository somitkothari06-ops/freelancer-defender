# The Freelancer Defender

**A source-linked workspace for freelancers handling disputed payments.**

Built for the PayPal AI Hackathon 2026. **Live: https://freelancer-defender.onrender.com** (landing page) · **https://freelancer-defender.onrender.com/desk** (personal desktop) · **https://freelancer-defender.onrender.com/app** (full investigation workbench)

**Start here:** [NOTES.md](NOTES.md) (what's built, what's real vs. demo, to-do list) · [docs/SUBMISSION.md](docs/SUBMISSION.md) (Devpost text) · [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (video script) · [docs/RESEARCH.md](docs/RESEARCH.md) (real freelancer stories and numbers)

**An AI coding agent picking this up fresh should read [AGENTS.md](AGENTS.md) first.**

## The problem

A freelancer finishes approved work and gets paid. Months later the client's bank reverses the charge. In PayPal's US card-chargeback guidance, a cardholder may have up to **180 days** to file and an issuer may take up to **75 days** to decide. The seller's response deadline is **case-specific**; the app reads it from the PayPal dispute record ([PayPal Help](https://www.paypal.com/us/cshelp/article/what-is-a-chargeback-and-why-did-i-get-one-help607)). Meanwhile, evidence is scattered across email, contracts and file-sharing logs.

Dispute-defense tools exist (Chargeflow, Justt), but this build focuses on the freelancer's signed scope, delivery trail, and client communication.

## What makes this different

The filed reason code and the client's practical concern may require different evidence. The seeded Halden case illustrates that gap:

> **Filed:** "Not as described. What we received cannot be used by our vendors and is not fit for purpose."
>
> **Underlying concern in the seeded Halden case:** the sign maker needs vector files to cut the storefront sign. The transfer service recorded **zero downloads** of the second package before its link expired; that record alone cannot establish whether the files reached the client another way. A later contact-form submission reports the sign maker's concern, but the account is not independently verified. The contract also makes ownership conditional on retained payment, so the rights question needs careful review.

The complaint does not mention files, vectors, signs or copyright. Reviewing the other records raises those questions. The product helps the freelancer do two things:
1. **Answers the bank on the filed reason**, because that's what the bank judges.
2. **Plan a response to the client's concern** (check which files were received, then consider a reissue under the contract).

### The reasoning trail is visible

The dashboard streams every step as it happens:

```
Pull dispute from PayPal → Read the complaint → Investigate (agent opens documents, records findings)
→ Find the real complaint (competing hypotheses, weighed) → Choose strategy (proof plan)
→ Draft response → Verify every citation → Send through PayPal
```

### Source quotations are machine-checked

Each claim in the response cites a specific document section (`CONTRACT §7.2`, `DELIVERY-LOG L5`, `PAYPAL-TXN 7HL40…`) **with an exact quote**. A deterministic checker (plain code, not AI) confirms that each quote appears in that section after normalizing typography and spacing. Claims whose citations fail get one repair attempt; if they still fail, they're removed and shown struck through. This verifies the quotation, not whether the claim correctly interprets it. The freelancer reviews each claim against its linked source before sending.

### Ask for evidence before guessing

A complaint and payment record alone cannot establish what happened. If there are no supporting documents, the app asks for the agreed scope, delivery records and relevant approvals before making any AI calls. The agent can also choose **Need more evidence** during an investigation, with targeted questions and a list of records to look for. In either case it prepares no letter, client message or refund action, and submission is blocked until a new investigation produces a response.

### It's honest

The agent lists potential weak points and can propose a partial refund for the freelancer to review. A seeded case illustrates that path; the model's proposal is not a finding that money is legally owed.

## How PayPal is used

PayPal is the money flow, not a logo:

| PayPal API | Used for |
|---|---|
| **Disputes API**: list / show details | The dispute queue, reason code, client statement, response deadline (`seller_response_due_date`) |
| **Disputes API**: `provide-evidence` | Submitting the response: JSON + generated PDF letter + evidence appendix (multipart) |
| **Disputes API**: `make-offer`, `accept-claim` | Partial refunds / conceding when the agent concludes part of the money is owed |
| **Disputes API**: `send-message` | Sending the "fix the real problem" message to the client (inquiry stage) |
| **Disputes API** sandbox: `require-evidence`, `adjudicate` | Driving a sandbox dispute through its full lifecycle |
| **Transaction Search API** | Payment history for context. Earlier payments do not by themselves resolve an unauthorized-transaction claim. |
| **Invoicing API** | Seeding real sandbox invoices that a sandbox buyer pays and then disputes |

PayPal records appear in the evidence locker as citable documents, just like the contract and emails.

## Bring your own evidence

PayPal holds the dispute and the payment; the proof that the work was agreed and delivered lives with the freelancer. On your own entered case or an authorized sandbox dispute, **+ Add evidence** takes a pasted or uploaded text document (contract, email thread, delivery log, chat export). Shared seeded cases are read-only. The document is split into quotable sections automatically: numbered contract clauses become `§3.2`-style sections, logs become one section per line, everything else one per paragraph. The agent then investigates and cites it exactly like the demo evidence, and the verifier checks every quote against it.

A live PayPal dispute with no evidence yet opens as a fresh case built only from PayPal's records, with a prompt to add documents. Nothing in the agent is specific to the demo disputes; they exist so the demo works without a real freelancer's paperwork.

The desktop also shows a **source-linked deliverable history** for private and live cases. A freelancer can name each file or version and record a dated promise, send, access event, client report, reissue, or acceptance with a link to an exact source section. The labels are user classifications; a sent link or access log does not by itself prove receipt, use, or acceptance. Shared demo cases remain read-only.

## Try your own case

On the dispute list, **Try your own case** lets anyone enter the client, work, amount, filed reason and client's words. The case is private to that browser's visitor cookie; added evidence can be analyzed live. **Fill in an example** provides a sample case to explore. Typed-in cases are never sent to PayPal and have no invented PayPal response deadline. In the desktop case view, **Download case copy** saves the case, source documents, deliverable history, notes and follow-ups as JSON. Render's free storage is ephemeral, so download copies of important cases. The file is an archive, not an automatic restore mechanism.

## Stack

- **Node.js + Express**, no build step, no framework. Small enough to read end to end.
- **Groq** running **`openai/gpt-oss-120b`**: tool calling for the investigation loop, strict JSON-schema outputs for every other stage.
- **PayPal REST APIs (sandbox)**: listed above.
- **AG Grid** (community), in two places where the data really is tabular:
  - the **dispute queue**: sort by deadline, filter by reason/source, live countdown cells;
  - the **evidence ledger**: one row per citation in the final response (claim, source document, section, exact quote, PayPal-or-freelancer origin, verification result). Judges or the freelancer can filter it to audit exactly what the response rests on; clicking a row opens the source with the quote highlighted.
- **Bryntum Scheduler** (trial) for the response-deadline timeline: one bar per dispute from now to its deadline, coloured by urgency.
- **Render** for hosting (`render.yaml` blueprint). Live at https://freelancer-defender.onrender.com

## Run it locally

```bash
cp .env.example .env     # add your Groq key and PayPal sandbox credentials
npm install
npm start                # http://localhost:3000
```

Without PayPal credentials the app runs on 4 seeded demo disputes and simulates submission (clearly labelled). Without a Groq key, the source-linked desktop case review still works. The historical AI recordings show the investigation sequence, but their unsupported interpretations and drafts are hidden and cannot be sent to PayPal.

Other commands:

```bash
npm test                              # citation checker + scenario integrity tests
npm run paypal:check                  # verify sandbox credentials and API access
npm run paypal:seed -- halden-brand   # send a real sandbox invoice for a scenario (see NOTES.md)
npm run run-one -- PP-D-27140-HALDEN --save   # run the agent in the terminal and record a replay
npm run eval                          # score recorded runs against each scenario's answer key
npm run benchmark                     # offline plan: 10 new synthetic cases + recorded token usage
npm run benchmark -- --run --case duplicate-capture --max-tokens 65000
```

See [docs/EVALUATION.md](docs/EVALUATION.md) for the comparison method, quota limits and manual review rubric. Benchmark execution is explicit, uses one configured key, saves partial runs, and never calls PayPal.

## Deploy (Render)

1. Render dashboard → **New +** → **Blueprint** → pick this repo. Render reads `render.yaml`.
2. When asked, paste `GROQ_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`. Set `LIVE_ACTION_EMAILS` to the exact PayPal sign-in email(s) allowed to view and act on the merchant's sandbox disputes. Keep it empty for a public demo with seeded cases only. Set a random `SESSION_SECRET`; the Blueprint can generate one. Optionally set `FREELANCER_NAME` / `FREELANCER_BUSINESS` / `FREELANCER_EMAIL` (used for live disputes not linked to a demo scenario).
3. Deploy. The health check is `/api/status`.

## Code map

```
server.js                 web server + API + live event stream (Server-Sent Events)
src/agent/defender.js     the agent: runs each reasoning stage, emits the trail
src/agent/prompts.js      prompts + JSON schemas for each stage (nothing scenario-specific)
src/agent/playbook.js     what each PayPal reason code makes the freelancer prove
src/agent/citations.js    deterministic exact-quote citation checker
src/agent/package.js      turns the verified draft into PayPal API calls + PDFs
src/evidence/locker.js    evidence documents split into citable sections, search
src/evidence/uploads.js   evidence the freelancer adds: splitting into sections + storage
src/paypal/*.js           PayPal OAuth, Disputes API, Transaction Search
src/ai/groq.js            Groq client with rate-limit pacing
src/cases.js              live sandbox disputes (linked or fresh) + seeded demo disputes
data/scenarios/*.json     4 demo disputes with their evidence lockers
data/replays/*.json       recordings of real agent runs
public/index.html         the landing page (/)
public/app.html, app.js   the dashboard (/app): dispute list, case pages; plain HTML/CSS/JS
public/desk.html, desk-live.js   the desktop (/desk): case switcher, exact source reader, private notes and follow-ups; opens /app for recorded and live investigations
```

See [NOTES.md](NOTES.md) for what's real vs. mocked and open items.
