# The Freelancer Defender

**An AI agent that fights on a freelancer's side when a client's bank reverses a payment they already earned.**

Built for the PayPal AI Hackathon 2026. **Live: https://freelancer-defender.onrender.com**

## The problem

A freelancer finishes approved work and gets paid. Months later the client's bank reverses the charge. The client could file up to **180 days** after paying, and their card company can take up to **75 days** to decide. The freelancer gets about **10 days** to respond ([PayPal Help](https://www.paypal.com/us/cshelp/article/what-is-a-chargeback-and-why-did-i-get-one-help607)), with months-old evidence scattered across email, contracts and file-sharing logs.

Dispute-defense tools exist (Chargeflow, Justt), but they're built for merchants with order databases. Nobody builds them for the person who did the work.

## What makes this different

Most dispute bots fill in a template for the filed reason code. That fails, because **the reason a client files is often not what's actually bothering them**:

> **Filed:** "Not as described. What we received cannot be used by our vendors and is not fit for purpose."
>
> **Really wrong:** their sign maker needs vector files to cut the storefront sign. Those files, plus the copyright assignment, were in a second download link the client never opened (0 downloads in the file log). It expired. The client asked about it through a contact form that was silently routing to a dead inbox. And under the contract, if the chargeback succeeds, the client *loses the rights* to the logo already printed on their cups.

No keyword links those. The complaint never says "files", "vector", "sign" or "copyright". The agent has to connect four documents. Then it does two things:
1. **Answers the bank on the filed reason**, because that's what the bank judges.
2. **Fixes the client's real problem** (re-send the files and the copyright letter), because that's what actually ends disputes.

### The reasoning trail is visible

The dashboard streams every step as it happens:

```
Pull dispute from PayPal → Read the complaint → Investigate (agent opens documents, records findings)
→ Find the real complaint (competing hypotheses, weighed) → Choose strategy (proof plan)
→ Draft response → Verify every citation → Send through PayPal
```

### Every claim is citation-grounded and machine-checked

Each sentence in the response cites a specific document section (`CONTRACT §7.2`, `DELIVERY-LOG L5`, `PAYPAL-TXN 7HL40…`) **with an exact quote**. A deterministic checker (plain code, not AI) confirms that each quote really appears in that section. Claims that fail get one repair attempt; if they still fail, they're removed and shown struck through. The model can't slip an invented fact into a legal-ish document.

### It's honest

The agent lists the freelancer's own weak points, and it will recommend a partial refund when part of the money is genuinely owed. One of the demo disputes is exactly that case.

## How PayPal is used

PayPal is the money flow, not a logo:

| PayPal API | Used for |
|---|---|
| **Disputes API**: list / show details | The dispute queue, reason code, client statement, response deadline (`seller_response_due_date`) |
| **Disputes API**: `provide-evidence` | Submitting the response: JSON + generated PDF letter + evidence appendix (multipart) |
| **Disputes API**: `make-offer`, `accept-claim` | Partial refunds / conceding when the agent concludes part of the money is owed |
| **Disputes API**: `send-message` | Sending the "fix the real problem" message to the client (inquiry stage) |
| **Disputes API** sandbox: `require-evidence`, `adjudicate` | Driving a sandbox dispute through its full lifecycle |
| **Transaction Search API** | The client's payment history as evidence (e.g. three earlier undisputed payments from the same account defeat an "unauthorized" claim) |
| **Invoicing API** | Seeding real sandbox invoices that a sandbox buyer pays and then disputes |

PayPal records appear in the evidence locker as citable documents, just like the contract and emails.

## Bring your own evidence

PayPal holds the dispute and the payment; the proof that the work was agreed and delivered lives with the freelancer. On any dispute, **+ Add evidence** takes a pasted or uploaded text document (contract, email thread, delivery log, chat export). It is split into quotable sections automatically: numbered contract clauses become `§3.2`-style sections, logs become one section per line, everything else one per paragraph. The agent then investigates and cites it exactly like the demo evidence, and the verifier checks every quote against it.

A live PayPal dispute with no evidence yet opens as a fresh case built only from PayPal's records, with a prompt to add documents. Nothing in the agent is specific to the demo disputes; they exist so the demo works without a real freelancer's paperwork.

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

Without PayPal credentials the app runs on the 4 seeded demo disputes and simulates submission (clearly labelled). Without a Groq key you can still use **Replay**, which plays back recorded real runs.

Other commands:

```bash
npm test                              # citation checker + scenario integrity tests
npm run paypal:check                  # verify sandbox credentials and API access
npm run paypal:seed -- halden-brand   # send a real sandbox invoice for a scenario (see NOTES.md)
npm run run-one -- PP-D-27140-HALDEN --save   # run the agent in the terminal and record a replay
npm run eval                          # score recorded runs against each scenario's answer key
```

## Deploy (Render)

1. Render dashboard → **New +** → **Blueprint** → pick this repo. Render reads `render.yaml`.
2. When asked, paste `GROQ_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`. Optionally set `FREELANCER_NAME` / `FREELANCER_BUSINESS` / `FREELANCER_EMAIL` (used for live disputes not linked to a demo scenario).
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
```

See [NOTES.md](NOTES.md) for what's real vs. mocked and open items.
