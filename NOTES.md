# Build notes: what's built, what's real, what's open

Status as of Oct 23, 2026 (last updated below; most of this doc is still the
Oct 20 pass and is still accurate — only the "Oct 23" section and this line
are new). Written for the two of us; judges should read the README. **If
you're an AI agent picking this project up fresh, read
[AGENTS.md](AGENTS.md) first**, not this file directly.

## Oct 23, 2026: AG Studio panel, judge-mode narration, landing redesign

### Evaluation and evidence guidance follow-up

- Added ten synthetic development cases and `npm run benchmark`: offline planning
  is the default, and explicit live comparisons use one configured Groq key with
  local estimated token/request/time guards. Results and partial failures are saved
  under gitignored `data/benchmark-runs/`; judge replays are left intact.
- One live baseline test recommended a refund without supporting evidence and
  incorrectly claimed it was already processed. Added `REQUEST_MORE_EVIDENCE`:
  cases with no freelancer records ask specific questions before using AI; an
  investigation can also pause after strategy. Paused cases generate no action
  package, PDFs or client message, and the server rejects submission.
- The UI and README now distinguish matched source quotations from proven claims.
  A correct quotation can still be attached to an incorrect interpretation.
- System instructions now treat documents as untrusted evidence and distinguish
  proposed remedies from completed actions. These are model instructions, not a
  guarantee of semantic correctness.
- Updated Express within version 4 to 4.22.3; the dependency audit reports zero
  known vulnerabilities after installation (October 23 check).
- Evaluation method, measured usage, incomplete experiments and next feature
  priorities are in [docs/EVALUATION.md](docs/EVALUATION.md). The development suite
  is not evidence of a recovery rate or a win over a single-prompt baseline.
- The no-evidence branch and submission refusal were verified locally. Deployment
  verification is recorded in the accompanying change report.

Added since the Oct 20 pass below (all live on production, all pushed):

- **"Ask about your disputes" panel** (`public/studio.js`, `server.js`'s
  `/api/studio/chat`): a natural-language query/chart panel on the dispute
  queue, built on **AG Grid's AG Studio** product (a second, separate AG
  Grid integration beyond the queue/evidence-ledger grids already in the
  Stack section below — strengthens the AG Grid sponsor-prize pitch).
  Required building a JSON-Schema-2020-12 → Groq-strict-tool-schema
  translation layer and fixing several real bugs along the way (dropped
  system instructions, a shared rate-limit budget across models, a
  required-but-silently-missing `artifacts` field). Full technical writeup,
  for anyone touching this code: **[docs/AG_STUDIO_TECHNICAL_NOTES.md](docs/AG_STUDIO_TECHNICAL_NOTES.md)**.
- **"▶ Watch an example" button** next to the panel's "Ask a question"
  toggle: a scripted, guaranteed-reliable demo conversation
  (`public/studio-demo.js`) for judges, so the panel has a zero-risk path
  alongside the live, model-driven one. The query it runs and the numbers
  it reports are real (pulled from Studio's real query engine); only the
  choice of which tool to call next is pre-scripted. See the technical
  notes doc for why.
- **Judge-mode real-time stage narration** (`public/app.js`,
  `public/styles.css`): in the `#/judge` auto-play, a spotlight-and-card
  explanation now appears automatically as each of the 8 reasoning stages
  starts, explaining in plain language what that stage is doing — same
  visual language as the first-visit tour, but automatic/repeatable and
  gated to judge mode only. Added because a judge watching the recording
  shouldn't have to infer what e.g. "Work out what's really wrong" means
  from the stage title alone.
- **Landing page "how it works" section redesigned** (`public/index.html`):
  the 3 steps are now a connected vertical timeline with filled color-coded
  nodes and card-style text, replacing a flatter numbered-divider list.
- Two correctness fixes worth knowing about even outside AG Studio: Groq's
  rate-limit budget tracker (`src/ai/groq.js`) now keys its state per model
  name instead of one shared tracker (was silently wrong the moment a
  second model name was ever used anywhere); the retry budget for Groq's
  flaky tool-call-parsing errors was raised from 3 to 6 attempts.
- **Operational note:** Render's `autoDeploy: yes` has repeatedly not fired
  reliably on a push to `main` this session. The reliable pattern is
  `git push` then `render deploys create srv-dbbihntg1s2s7393u3dg --confirm`
  — don't assume a push alone means the live site updated; verify.

## Your to-do before submitting (deadline Nov 12, 2026, 12:00 pm Pacific)

1. **Record the demo video** (under 3 min, YouTube, no copyrighted music). Script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).
2. **Fill in Devpost** from [docs/SUBMISSION.md](docs/SUBMISSION.md); enter AG Grid as the sponsor prize.
3. **Make the GitHub repo public** and check the MIT license shows in the repo's About box.
4. **Rotate secrets that were shared in chat:** create a new PayPal sandbox secret (developer.paypal.com → your app → Secret key, then update it in Render → Environment), delete the Render API key used for setup (Render → Account settings → API Keys), and **regenerate the Groq key** (then update it in Render too — multiple Groq keys were pasted into chat sessions on Oct 20 and Oct 23, so this one is not optional).
5. **Optional:** add a card in Render Billing and switch the service to Starter so it never sleeps during judging (Dec 1–15). The $50 credit covers it.

## What's built

One end-to-end flow:

1. **A dispute comes in.** The dashboard queue (AG Grid) lists disputes sorted by time left. Each one comes from either:
   - the **PayPal sandbox** (real, via the Disputes API), or
   - one of 4 **seeded demo disputes** in `data/scenarios/`. These use the exact JSON shape PayPal's API returns but don't exist inside PayPal.

   A live dispute is linked to a demo scenario's evidence automatically when its items and amount match (that's how our sandbox test dispute works). Any other live dispute opens as a **fresh case** with only PayPal's records, and the freelancer adds their own documents with **+ Add evidence**.
2. **The agent reasons through it, visibly.** Each stage streams to the browser as it happens:
   | Stage | What happens | AI? |
   |---|---|---|
   | Intake | Load the dispute + the client's payment history (Transaction Search) | no |
   | Read | Separate what the client literally claims from the vague phrases that may hide the real problem | yes |
   | Investigate | Tool-using loop: the agent opens documents, searches, records findings with citations | yes |
   | Diagnose | 2–4 competing hypotheses weighed against evidence → "what they filed" vs "what's really wrong" | yes |
   | Strategy | Contest / contest + fix the real problem / partial refund / accept, plus a proof plan answering every test the bank applies | yes |
   | Draft | Response written as claims, each with exact-quote citations; plus a message to the client fixing the real problem | yes |
   | Verify | Every quote is checked word-for-word against its source section. Failures get one AI repair pass, then are removed | **no**, plain code |
   | Package | Builds the PayPal `provide-evidence` request (JSON + 2 generated PDFs), and `make-offer` / `send-message` where they apply | no |
3. **Submit.** For live sandbox disputes the app makes the real PayPal API calls. For seeded disputes it shows the exact request it would send.

## Real vs. mocked

| Piece | Status |
|---|---|
| AI reasoning (Groq, `openai/gpt-oss-120b`) | **Real.** Live calls. Model id checked Oct 20, 2026: still listed and active on Groq. |
| Citation verification | **Real**, deterministic code (`src/agent/citations.js`), unit-tested (`npm test`). |
| PayPal Disputes API client | **Verified against the sandbox on Oct 20, end to end on a real dispute (`PP-R-LFT-10193672`):** list + get dispute ✓, `send-message` ✓ (inquiry stage), buyer escalation → CHARGEBACK / WAITING_FOR_SELLER_RESPONSE ✓, `provide-evidence` with our JSON + 2 generated PDFs ✓ (accepted, dispute moved to UNDER_REVIEW). `make-offer`, `accept-claim` and `adjudicate` are written to spec, not yet exercised. |
| PayPal Transaction Search | **Verified** (after enabling the feature on the app). New sandbox payments can take hours to appear; until then live cases fall back to seeded history, labelled as such. |
| PayPal Invoicing (`npm run paypal:seed`) | **Verified**: created a real sandbox invoice that the US sandbox buyer paid ($2,400). |
| The 4 disputes in the queue | **Mocked**: seeded JSON in PayPal's API format. Labelled "Demo data" in the UI. |
| Evidence lockers (contracts, emails, logs, screenshots) | Demo disputes: **mocked** (the freelancer's own paperwork, which PayPal doesn't hold). **Real for any dispute via + Add evidence**: paste or upload text and it's split into citable sections (`src/evidence/uploads.js`). Stored in `data/uploads/`, which Render's free plan wipes on each deploy or restart. PDFs must be pasted as text for now; Gmail/Drive import would be the next step. |
| Submission for seeded disputes | **Simulated**, labelled as such, showing the exact HTTP request. |
| Replays (`data/replays/*.json`) | Recordings of **real live runs**, played back faster. Labelled "Replaying a recorded live run" in the UI. For demos and when Groq is rate-limited. |

### How a real sandbox dispute gets created

A merchant app **cannot** create a dispute against itself; the buyer has to file it. PayPal's own test docs describe it like this ("Log in to your sandbox personal account as a buyer… create a dispute"). So:

1. `npm run paypal:seed -- halden-brand` sends a real sandbox invoice from your business account to your sandbox buyer.
2. Log in at sandbox.paypal.com **as the buyer**, pay it, then open the Resolution Center and report a problem ("not as described"), pasting the statement the script prints.
3. The dashboard picks it up with a green "PayPal live" badge. It's linked to the scenario's evidence locker automatically, by invoice number.
4. If PayPal puts it in `UNDER_REVIEW`, use the sandbox-only `require-evidence` call (`POST /api/cases/<id>/sandbox/require-evidence`) to move it to `WAITING_FOR_SELLER_RESPONSE`. Run the agent, submit, then `adjudicate` to finish the lifecycle.

A buyer-filed sandbox dispute is an **internal PayPal dispute**, not a bank chargeback. That's fine for the demo, and it unlocks `send-message` (the client message goes through PayPal). Our story is about bank chargebacks; the code handles both (in the chargeback stage the client message becomes an email instead).

## The hero scenario (read this before the pitch)

**Halden Coffee Roasters vs. Priya Raman Design**, $2,400, filed as *"not as described"*.

- **What the client says:** the work "cannot be used by our vendors" and is "not fit for purpose."
- **What's really wrong:** the client's sign maker can't make a storefront sign from web PNGs. The **vector master files and the copyright assignment** were in a second download link the client **never opened** (the file log shows 0 downloads). The link expired. The client then asked about it through Priya's website contact form, but that form was quietly routing to a dead inbox after a site migration. The client also wonders whether they even own the logo.
- **Why a keyword bot misses it:** the complaint never mentions files, vectors, signs or ownership. The connection runs across 4 separate documents: the dispute statement → the download log → a contact-form message → the contract's re-issue and IP clauses.
- **The twist the agent should surface:** under the contract, copyright only transfers on full payment. If the chargeback succeeds, the client loses the rights to the logo already printed on their cups. They almost certainly don't want the money back. They want the files.
- **Honest weak point:** Priya never answered the client's message (through no fault of hers, but still), and §8 allows refunds if the Final Asset Package isn't delivered. The agent should acknowledge this, not hide it.

The other three:
- **Tandem Health (unauthorized, $4,500):** not fraud. The co-founder who hired Marcus left. The CEO doesn't recognize the vendor, but he personally merged the paid-for code. Prior undisputed payments (from Transaction Search) matter here.
- **Patel Family Dental (not received, $1,800):** the site was delivered and ran for 112 days. The client's own hosting card failed, and he thinks the developer took the site down.
- **Brightline Fitness (not as described, $1,500):** the honest case. Article 5 really was never delivered and the writer went quiet. The right answer is to refund $250, contest the other $1,250 (approved and published), and apologize.

`npm run eval` scores recorded runs against an answer key (in each scenario file, never sent to the model).

## Open items for you

1. **PayPal sandbox is working.** See the table above for what's verified. Things to know:
   - **Your sandbox accounts are in India.** Indian PayPal accounts can't pay each other, so we created a **US** Personal buyer (`sb-646sv…@personal.example.com`) to pay the Indian business account.
   - **Real PayPal lifecycle (what we learned):** a buyer-filed dispute starts as an **INQUIRY** (20-day seller window). Only `send_message` / `make_offer` / `accept_claim` / `escalate` are allowed then. **Evidence can only be submitted after escalation to a claim** (CHARGEBACK stage). The app reads PayPal's allowed actions (HATEOAS links) at submit time and explains anything it skips.
   - **The deadline is real data:** the inquiry window was 20 days, not 48 hours. While PayPal is reviewing, there's no seller deadline at all (the dashboard shows "No deadline").
   - **The invoice shows "Test Store"** as the seller name. That's the sandbox business account's default; rename it in that account's profile for a nicer demo.
   - **Rotate the client secret** before the repo goes public (it was shared in chat). Put credentials in `.env` locally and in Render's Environment tab.
   - **Making another live dispute:** `npm run paypal:seed -- <scenario>` sends the invoice. Then, as the buyer at sandbox.paypal.com: pay → Resolution Center → Report a Problem → "not as described". Claude did this with a headless browser in about 10 minutes, so ask in a session if you want it done again.
2. **Groq free tier = slow live runs, and only ~4 per day.** It's capped at 8,000 tokens/minute **and 200,000 tokens/day** for gpt-oss-120b. One full run uses ~45–50k tokens, so it takes ~5–7 minutes (mostly pausing), and the daily cap allows about 4 runs. A judge clicking "Run live" after the quota is used gets a clear "daily limit reached, use replay" message. Options:
   - Upgrade the Groq account to the Developer tier (pay-as-you-go). At gpt-oss-120b prices a full run costs roughly 1–2 cents, and it would finish in under a minute. Recommended before recording the demo video.
   - Or demo with replays (real recorded runs, labelled as replays).
3. **The "48 hours" claim is retired (researched Oct 20).** No source supports it. The pitch and the clock now use sourced numbers:
   - **Client can file:** up to **180 days** after paying. Source: [PayPal Help](https://www.paypal.com/us/cshelp/article/what-is-a-chargeback-and-why-did-i-get-one-help607), *"Customers can initiate a chargeback within 180 days of the transaction date."*
   - **Card company decides:** up to **75 days**. Source: same page, *"it may take your buyer's card company up to 75 days to resolve a chargeback"*.
   - **US law (Reg Z, 12 CFR 1026.13(c)(2)):** for credit card billing errors the issuer must resolve within 2 billing cycles, max 90 days. This is the likely origin of the old "90 days".
   - **Freelancer responds:** about **10 days** for a chargeback. A PayPal help page is quoted as "you'll have 10 days to answer it", and Chargeflow and Chargeback Gurus agree, but we couldn't load the PayPal page directly, so say "about 10 days".
   - **PayPal internal disputes:** a 20-day inquiry, then PayPal decides within 10 days (PayPal developer docs). We saw the 20-day window on our real sandbox dispute.
   - **Suggested pitch line:** *"Your client can file up to 180 days after paying. Their card company can take up to 75 days to decide. You get 10 days."*
4. **Competitor check.** There is a public repo, [bail-builds/dispute-defender](https://github.com/bail-builds/dispute-defender), built for this same hackathon: a PayPal sandbox dispute agent for small shops, with a win score and a drafted reply. Our differentiators are the stated-vs-real reasoning, exact-quote citations with deterministic verification, freelancer focus, and fixing the client's real problem alongside the bank response. Lean on those in the pitch.
5. **Deployed on Render:** https://freelancer-defender.onrender.com (service `srv-dbbihntg1s2s7393u3dg`, auto-deploys on every push to `claude/gifted-ptolemy-xj62ly` via Render's GitHub app, which must have access to this repo; switch the branch to `main` after merging). It's on the free plan, which sleeps after ~15 min idle, so the first load takes ~30–50s. To stay awake, add a card under Billing and switch the instance type to Starter ($7/mo, covered by the $50 hackathon credit). Delete the Render API key used for setup once deployed.
6. **Devpost rules.** Confirm the official rules page yourselves: deadline (Nov 12, 2026, 3:00 PM EST per the Devpost listing), required demo-video length, and whether AI-assisted code must be disclosed.

## Design decisions worth knowing

- **Why stages, not one big prompt:** each stage's output is structured JSON (Groq strict JSON schema), so the UI can draw it, and a later stage can't quietly invent facts that weren't found earlier.
- **Why the verifier is plain code:** an AI checking an AI's citations is not a guarantee. Substring matching is.
- **Why AG Grid:** the queue is a real data table (sort by deadline, filter by reason, live countdown cells), which is what AG Grid is for. We didn't use it anywhere it doesn't fit.
- **No database:** runs are kept in memory and replays are files. Restarting the server clears in-memory runs. That's fine for a demo.

## Hackathon rules (read from the official Devpost page, Oct 20)

- **Deadline: Nov 12, 2026, 12:00 pm Pacific.** Judging runs **Dec 1–15**, so the hosted demo (and its API keys) must keep working until then.
- **Required:**
  - a public repo with an open-source license visible in the repo's About section (`LICENSE` is MIT; check that GitHub shows it in About);
  - a working demo (a hosted URL, or run instructions);
  - a list of the AI tools used and how;
  - a **demo video under 3 minutes**, public on YouTube, with no copyrighted music.
- **A project can win at most one sponsor prize.** AG Grid pays $5,000/$2,000/$1,000 cash; Render pays $1,000 in credits. **Aim for AG Grid.** The queue and the evidence ledger are both AG Grid, so show them in the video. Render still hosts the app.
- **Relevant honorable mentions:** Best Use of PayPal + AI, Most Impactful, Best Demo Delivery, Best Use of Agentic Commerce.
- **Judges may use "automated AI-driven analysis"**, so a clear README and code comments help.

## Current recorded runs (replays)

Each one is a real live run of the agent, recorded and played back with the "Replay a recorded run" button. Scored by `npm run eval` against each scenario's answer key:

| Dispute | Key evidence found | Strategy | Claims grounded | Notes |
|---|---|---|---|---|
| Halden (hero) | 3/4 | ✓ contest + fix | 8/8 | Finds the copyright-on-payment twist (§6.1): tells the bank a reversal would cost the client the logo. Missed the contact-form message this run. |
| Tandem | 4/4 | ✓ contest + fix | 10/10 | Explains the co-founder who hired Marcus had left (Slack K3). |
| Brightline | 4/4 | ✓ partial refund + contest | 10/10 | Honest case handled correctly. |
| Patel | 3/4 | ✓ contest + fix | 9/9 | Finds the client's own hosting lapsed; missed the Google review (R2). |
