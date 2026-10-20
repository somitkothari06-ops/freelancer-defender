# Build notes: what's built, what's real, what's open

Status as of Oct 20, 2026. Written for the two of us; judges should read the README.

## What's built

One end-to-end flow:

1. **A dispute comes in.** The dashboard queue (AG Grid) lists disputes sorted by time left. Each one comes from either:
   - the **PayPal sandbox** (real, via the Disputes API), or
   - one of 4 **seeded demo disputes** in `data/scenarios/`. These use the exact JSON shape PayPal's API returns but don't exist inside PayPal.
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
| PayPal Disputes API client (list, get, provide-evidence, make-offer, send-message, accept-claim, sandbox require-evidence/adjudicate) | **Written to PayPal's published spec, NOT yet run against PayPal.** Our sandbox credentials weren't available in the build container (see Open items). |
| PayPal Transaction Search | Same: written to spec, not yet run live. |
| PayPal Invoicing (`npm run paypal:seed`) | Same. Creates a real sandbox invoice so a sandbox buyer can pay and then dispute it. |
| The 4 disputes in the queue | **Mocked**: seeded JSON in PayPal's API format. Labelled "Demo data" in the UI. |
| Evidence lockers (contracts, emails, logs, screenshots) | **Mocked**, and always will be. This is the freelancer's own paperwork, which PayPal doesn't hold. In a real product the freelancer uploads it or connects Gmail/Drive. |
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

1. **PayPal sandbox credentials didn't reach the build container.** Groq worked (the environment injected the key), but `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` weren't visible and OAuth returned `invalid_client`. So none of the PayPal code has run against PayPal yet. Next step: put the **Sandbox** (not Live) client ID + secret in `.env` locally or in Render's Environment tab, then run `npm run paypal:check`.
2. **Groq free tier = slow live runs, and only ~4 per day.** It's capped at 8,000 tokens/minute **and 200,000 tokens/day** for gpt-oss-120b. One full run uses ~45–50k tokens, so it takes ~5–7 minutes (mostly pausing), and the daily cap allows about 4 runs. A judge clicking "Run live" after the quota is used gets a clear "daily limit reached, use replay" message. Options:
   - Upgrade the Groq account to the Developer tier (pay-as-you-go). At gpt-oss-120b prices a full run costs roughly 1–2 cents, and it would finish in under a minute. Recommended before recording the demo video.
   - Or demo with replays (real recorded runs, labelled as replays).
3. **Verify the "48 hours" claim before pitching.** PayPal's docs (checked Oct 2026) describe buyers having 180 days to file internal disputes and ~20 days to resolve before escalation. For bank chargebacks the seller response window is set by PayPal and the card network. We found **no PayPal source for "48 hours"**. The dashboard reads the real deadline from `seller_response_due_date`; the demo scenarios use 48h. The 90/120-day bars are constants in `src/config.js`. Please find and cite sources (card network rules, PayPal's seller response windows) or adjust the numbers. A judge may ask.
4. **Competitor check.** There is a public repo, [bail-builds/dispute-defender](https://github.com/bail-builds/dispute-defender), built for this same hackathon: a PayPal sandbox dispute agent for small shops, with a win score and a drafted reply. Our differentiators are the stated-vs-real reasoning, exact-quote citations with deterministic verification, freelancer focus, and fixing the client's real problem alongside the bank response. Lean on those in the pitch.
5. **Render deploy needs your account.** See README → Deploy. `render.yaml` is ready (free plan). Note that free Render services sleep after inactivity; the first page load takes ~30–50s. Open it before judges do.
6. **Devpost rules.** Confirm the official rules page yourselves: deadline (Nov 12, 2026, 3:00 PM EST per the Devpost listing), required demo-video length, and whether AI-assisted code must be disclosed.

## Design decisions worth knowing

- **Why stages, not one big prompt:** each stage's output is structured JSON (Groq strict JSON schema), so the UI can draw it, and a later stage can't quietly invent facts that weren't found earlier.
- **Why the verifier is plain code:** an AI checking an AI's citations is not a guarantee. Substring matching is.
- **Why AG Grid:** the queue is a real data table (sort by deadline, filter by reason, live countdown cells), which is what AG Grid is for. We didn't use it anywhere it doesn't fit.
- **No database:** runs are kept in memory and replays are files. Restarting the server clears in-memory runs. That's fine for a demo.
