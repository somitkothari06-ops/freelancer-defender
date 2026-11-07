# Devpost submission draft

Copy each section into the matching Devpost field. Edit freely: it should sound like you.

**Project name:** The Freelancer Defender

**Tagline (short description):** An evidence workbench for freelancers facing payment disputes: answer the filed reason and investigate the client's underlying concern.

**Links**
- Live demo: https://freelancer-defender.onrender.com (free hosting: the first load can take ~40 seconds to wake up)
- Code: https://github.com/somitkothari06-ops/freelancer-defender
- Video: *(your YouTube link)*

**Sponsor prize to enter:** Best Use of AG Grid. (A project can win only one sponsor prize; Render also hosts the app and Bryntum draws the deadline timeline.)

---

## Inspiration

A freelancer finishes the work, the client approves it, the client pays. Months later the client's bank reverses the payment. PayPal's US card-chargeback guidance says a cardholder may have up to 180 days to file and an issuer may take up to 75 days to decide. The seller's response deadline is case-specific. Meanwhile, evidence is scattered across email, contracts and file-sharing logs.

Dispute tools exist, but this one focuses on the freelancer's scope, delivery trail and client communication. The filed reason and the underlying client concern can require different evidence.

The problem has documented examples, including a freelancer whose published articles were later charged back ([The Write Life](https://thewritelife.com/chargebacks/)). We leave broad prevalence and recovery statistics out of the product pitch because the available sources do not establish rates for freelancers specifically. More source notes are in [docs/RESEARCH.md](RESEARCH.md).

## What it does

The desktop case workspace puts the filed reason, available records, and open questions together. Each source-linked point opens the exact document section. For a private or authorized sandbox case, the freelancer can also track each deliverable and its dated, sourced handoff events without treating a sent link as proof of receipt. A private follow-up turns an unresolved question into a next step. The agent then reads the case and produces three reviewable stages:

1. **What the client told their bank**, e.g. "Not as described: what we received can't be used by our vendors."
2. **What the evidence suggests and leaves open**, e.g. the seeded transfer service recorded no download of the second package before its link expired. A later client-submitted message reports the sign maker's print-file concern, but its account is not independently verified. The contract's ownership terms raise another question to review.
3. **A proposed response**: choose a path only after checking the missing facts, including file access and the contract's rights terms.

Then it writes the response to the bank and a friendly message to the client. **Each claim in the response cites a quote from a specific document**, and plain code (not AI) checks that the quoted words appear in the source. Claims whose citations still fail after a repair attempt are removed. Quote matching does not prove that a claim correctly interprets its source; the freelancer can inspect each source before sending. Finally it builds the PayPal API calls (provide evidence with a generated PDF letter and evidence appendix, send message, make offer), which the freelancer reviews and submits.

If supporting documents are absent, it asks for evidence before making any AI calls. The agent can also pause an investigation to ask targeted questions when essential facts remain unknown. A paused case cannot submit a response or refund.

The agent lists possible weaknesses and, in one seeded case, proposes a partial refund for human review because a contracted item appears absent from the provided records.

Freelancers can add evidence to their own entered case or an authorized PayPal sandbox dispute (paste or upload a contract, an email thread, a delivery log), and it becomes citable immediately. Shared seeded demo cases are read-only. Anyone can also **try their own case**: type in what the client told their bank, add the paperwork, and watch the agent work on a story it has never seen.

## How we built it

- **PayPal APIs (sandbox):** Disputes API (list, details, provide-evidence with multipart PDFs, send-message, make-offer, accept-claim, plus the sandbox lifecycle calls), Transaction Search (the client's payment history as evidence) and Invoicing (to create real sandbox payments that a sandbox buyer then disputes). We took a real sandbox dispute through its whole lifecycle: payment → dispute → escalation → evidence submitted and accepted.
- **AI:** Groq running `openai/gpt-oss-120b`. The agent works in stages: read the complaint, investigate with tools (open documents, search, record findings), weigh competing hypotheses, choose a strategy, then draft. Structured JSON makes stage outputs inspectable; it does not eliminate incorrect inferences.
- **Citation verifier:** deterministic code that checks every quote against its source section, with one AI repair pass for failures.
- **AG Grid:** the dispute list (sortable by deadline, live countdown cells) and the evidence ledger (one row per citation: claim, source, section, exact quote, quote-check result), which lets anyone audit what the response rests on.
- **Bryntum Scheduler:** the deadline timeline, one bar per dispute from now until its response deadline.
- **Render:** hosting.
- Plain Node.js + Express and vanilla JS, no build step.

## AI tools used

- **Groq + gpt-oss-120b** inside the product: the agent's reasoning, tool use and drafting.
- **Claude Code, Codex, and OpenCode Go** to help write and review the code, research PayPal's API behaviour, and refine the interface. *(Check the rules for any required wording on AI-assisted development.)*

## Challenges we ran into

- **The real PayPal lifecycle differs from what we expected.** A buyer-filed dispute starts as an inquiry where evidence can't be submitted; it has to be escalated first. The app now reads PayPal's allowed actions (HATEOAS links) before sending anything.
- **Keeping the AI honest.** Early drafts cited sections that didn't contain the quoted words. We added the deterministic verifier, which rejects any quote that isn't in its source.
- **Free-tier limits.** Groq's quota constrains live runs, so we added rate-limit pacing and historical recorded runs. Those older AI outputs are labeled as such; they require human review and cannot be submitted to PayPal.

## Accomplishments that we're proud of

- The case workbench makes a mismatch visible: the filed complaint omits files and signage, while other records raise those issues and leave an unanswered delivery question.
- Drafted claims carry exact source quotes checked by code. The freelancer must still decide whether each quote actually supports the claim.
- A real end-to-end PayPal sandbox flow, not a mock-up.

## What we learned

The reason code on a dispute is a category, not the whole story. A useful response addresses that category while separately checking the client's practical concern.

## What's next

- Import evidence straight from Gmail, Google Drive and file-sharing logs (and read PDFs directly).
- Deadline alerts by email or SMS the moment a dispute arrives.
- Live PayPal (production) once the flow is proven with real freelancers.

## Built with

`node.js` `express` `javascript` `paypal-disputes-api` `paypal-transaction-search` `paypal-invoicing` `groq` `gpt-oss-120b` `ag-grid` `bryntum` `render`
