# Devpost submission draft

Copy each section into the matching Devpost field. Edit freely: it should sound like you.

**Project name:** The Freelancer Defender

**Tagline (short description):** An AI agent that defends freelancers when a client's bank reverses a payment they already earned, by working out what the client is really upset about.

**Links**
- Live demo: https://freelancer-defender.onrender.com (free hosting: the first load can take ~40 seconds to wake up)
- Code: https://github.com/somitkothari06-ops/freelancer-defender
- Video: *(your YouTube link)*

**Sponsor prize to enter:** Best Use of AG Grid. (A project can win only one sponsor prize; Render also hosts the app and Bryntum draws the deadline timeline.)

---

## Inspiration

A freelancer finishes the work, the client approves it, the client pays. Months later the client's bank reverses the payment. The client had up to 180 days to file, and their bank can take up to 75 days to decide, but the freelancer gets about 10 days to answer, with evidence scattered across email, contracts and file-sharing logs.

Dispute tools exist, but they're built for online shops with order databases. Nobody builds them for the person who did the work. And they all make the same mistake: they answer the reason the client *filed*, which is often not what is actually wrong.

It happens to real people. A writer was paid $125 for five articles; the client thanked her, published them, then charged the payment back, and she paid a $20 fee on top ([The Write Life](https://thewritelife.com/chargebacks/)). A developer was asked to refund $12,500 on an "unauthorized" claim, when the client had simply used a card that wasn't his ([Hacker News](https://news.ycombinator.com/item?id=29862860)). Friendly fraud makes up about 44% of the chargebacks merchants absorb, and they recover only about 11% on average ([Chargebacks911 2026 report](https://www.accountsrecovery.net/2026/09/01/friendly-fraud-accounts-for-44-of-chargebacks-chargebacks911-report-finds/)). And 70% of US freelancers get paid through PayPal ([PayPal](https://newsroom.paypal-corp.com/PayPal-Releases-Global-Freelancer-Insights)). More in [docs/RESEARCH.md](RESEARCH.md).

## What it does

The Freelancer Defender pulls a dispute from PayPal, reads the freelancer's evidence, and works out three things, shown as three cards:

1. **What the client told their bank**, e.g. "Not as described: what we received can't be used by our vendors."
2. **What's actually going on**, e.g. the client never downloaded the second link with the print files and the copyright letter, the link expired, and their sign maker can't cut a storefront sign from web images. They're also worried they don't legally own the logo. Under the contract, ownership transfers only once payment is kept, so winning the chargeback would actually cost them the logo.
3. **What we'll do about it**: contest the reversal *and* fix the real problem (re-send the files and the copyright letter).

Then it writes the response to the bank and a friendly message to the client. **Each claim in the response cites a quote from a specific document**, and plain code (not AI) checks that the quoted words appear in the source. Claims whose citations still fail after a repair attempt are removed. Quote matching does not prove that a claim correctly interprets its source; the freelancer can inspect each source before sending. Finally it builds the PayPal API calls (provide evidence with a generated PDF letter and evidence appendix, send message, make offer), which the freelancer reviews and submits.

If supporting documents are absent, it asks for evidence before making any AI calls. The agent can also pause an investigation to ask targeted questions when essential facts remain unknown. A paused case cannot submit a response or refund.

The agent is honest. It lists the freelancer's own weak points, and in one demo case it recommends a partial refund because part of the work really wasn't delivered.

Freelancers can add their own evidence to any dispute (paste or upload a contract, an email thread, a delivery log), and it becomes citable immediately. Anyone can also **try their own case**: type in what the client told their bank, add the paperwork, and watch the agent work on a story it has never seen.

## How we built it

- **PayPal APIs (sandbox):** Disputes API (list, details, provide-evidence with multipart PDFs, send-message, make-offer, accept-claim, plus the sandbox lifecycle calls), Transaction Search (the client's payment history as evidence) and Invoicing (to create real sandbox payments that a sandbox buyer then disputes). We took a real sandbox dispute through its whole lifecycle: payment → dispute → escalation → evidence submitted and accepted.
- **AI:** Groq running `openai/gpt-oss-120b`. The agent works in stages: read the complaint, investigate with tools (open documents, search, record findings), weigh competing hypotheses, choose a strategy, then draft. Structured JSON makes stage outputs inspectable; it does not eliminate incorrect inferences.
- **Citation verifier:** deterministic code that checks every quote against its source section, with one AI repair pass for failures.
- **AG Grid:** the dispute list (sortable by deadline, live countdown cells) and the evidence ledger (one row per citation: claim, source, section, exact quote, verified or not), which lets anyone audit what the response rests on.
- **Bryntum Scheduler:** the deadline timeline, one bar per dispute from now until its response deadline.
- **Render:** hosting.
- Plain Node.js + Express and vanilla JS, no build step.

## AI tools used

- **Groq + gpt-oss-120b** inside the product: the agent's reasoning, tool use and drafting.
- **Claude Code** to help write the code, research PayPal's API behaviour and design the interface. *(Check the rules for any required wording on AI-assisted development.)*

## Challenges we ran into

- **The real PayPal lifecycle differs from what we expected.** A buyer-filed dispute starts as an inquiry where evidence can't be submitted; it has to be escalated first. The app now reads PayPal's allowed actions (HATEOAS links) before sending anything.
- **Keeping the AI honest.** Early drafts cited sections that didn't contain the quoted words. We added the deterministic verifier, which rejects any quote that isn't in its source.
- **Free-tier limits.** Groq's free tier allows about 4 full runs a day, so we added rate-limit pacing and recorded real runs for instant replay in the demo.

## Accomplishments that we're proud of

- The agent finds problems no keyword could: the complaint never mentions files, signs or copyright, yet it connects four documents to find them.
- Every claim in the response is traceable to an exact quote, and checked by code.
- A real end-to-end PayPal sandbox flow, not a mock-up.

## What we learned

The reason code on a dispute is a menu choice, not the story. The fastest way to end a dispute is often to fix the client's real problem, while still answering what the bank will judge.

## What's next

- Import evidence straight from Gmail, Google Drive and file-sharing logs (and read PDFs directly).
- Deadline alerts by email or SMS the moment a dispute arrives.
- Live PayPal (production) once the flow is proven with real freelancers.

## Built with

`node.js` `express` `javascript` `paypal-disputes-api` `paypal-transaction-search` `paypal-invoicing` `groq` `gpt-oss-120b` `ag-grid` `bryntum` `render`
