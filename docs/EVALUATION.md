# Test useful behavior without exhausting the AI allowance

Run `npm run benchmark` first. It lists ten synthetic development cases and reads token usage from existing replays with **zero network calls**. `npm test` and the Studio adapter tests are also offline.

## Groq capacity checked October 23, 2026

The existing primary credential successfully answered a 97-token smoke test. Its response reported 8,000 tokens/minute and 1,000 requests/day. Those headers do **not** report remaining tokens for the day.

Groq's published free-plan limits for `openai/gpt-oss-120b` are 8,000 tokens/minute and 200,000 tokens/day. The exact account Limits page takes precedence. Limits are organization-wide, not multiplied by generating more keys. Groq's acceptable-use policy disallows using multiple accounts or organizations to exceed usage limits; this runner never rotates or falls back between keys.

The four existing demo recordings used 40,444–55,001 tokens and 293–359 seconds each. A conservative allowance is three full-sized runs/day, leaving capacity for the hosted demo, Studio and smaller tests. This is a planning estimate, not a measurement of remaining quota. Smaller fixtures can cost much less. Cached tokens may reduce rate-limit usage; cache hits are not guaranteed.

Official references:

- [Rate limits and header meanings](https://console.groq.com/docs/rate-limits)
- [Model prices and capabilities](https://console.groq.com/docs/models)
- [Prompt caching](https://console.groq.com/docs/prompt-caching)
- [Acceptable-use policy](https://console.groq.com/docs/legal/ai-policy)

## Run one comparison

Configure one `GROQ_API_KEY` in the local environment or gitignored `.env`. Never paste a secret into chat or commit it. Then:

```sh
npm run benchmark -- --run --case duplicate-capture --max-tokens 65000 --max-requests 30
```

The runner executes a single-prompt baseline and the multi-stage agent, using the same configured model, source documents, system instructions and output schemas. Both get the same one-repair-then-drop citation policy. The baseline sees all documents immediately; the agent discovers them through its existing tools. This compares the complete workflows, including their different reasoning effort and number of calls; it does not isolate tool use alone.

Use `--approach baseline` or `--approach agent` for a focused run. Live execution requires one explicit `--case`; there is no command that silently runs all ten. There is no daily automation.

Outputs go in gitignored `data/benchmark-runs/<timestamp>-<case>-<random>/`. Each report includes model, Git revision, dirty-worktree status, code and fixture hashes, wall-clock time, actual reported prompt/completion/cached tokens, API attempt count, mechanical checks and pending manual questions. Results and agent events are saved separately. Partial failures stay saved; existing judge replays are never overwritten.

The CLI transport permits only Groq chat requests, so a benchmark cannot submit to PayPal. It checks an approximate token reservation, request count and elapsed-time allowance before each request. Reservations use byte-length estimates plus maximum completion size: this is a conservative local guard, **not an exact hard token cap**. Responses without known usage retain their reservation. At most three short HTTP 429 backoffs (retry-after up to 30 seconds) are passed to the existing client's retry logic and counted as attempts. Longer or unspecified HTTP 429 delays, exhausted short retries, and HTTP 5xx stop the experiment and preserve headers. There is no key switching. Pacing inside the existing client can extend elapsed time between checks.

## What the scores do and do not mean

Mechanical checks cover expected strategy (when unambiguous), refund amount, required evidence references, quotation matches, removed claims, explicit requests for evidence, and forbidden injection text. Merely citing a required section does not establish that it was understood.

Every completed result starts with `semantic_review: PENDING`. A human must read the result and source records and record:

1. Did the diagnosis distinguish established facts from allegations and hypotheses?
2. Did the quoted evidence support each claim, rather than merely contain the quoted words?
3. Did it acknowledge the freelancer's weaknesses and avoid inventing completed actions?
4. Was the recommended remedy justified, and was the refund amount correct?
5. If records were missing, did it ask useful questions instead of assuming guilt or inventing a cause?
6. Could the freelancer use this response with little correction? What correction was needed?

Do not average mechanical checks into an unsupported "accuracy" or chargeback-win rate. Zero claims is not 100% accuracy. A completed PayPal submission is not evidence of winning a dispute.

The ten cases are newly authored **synthetic development fixtures**, not real customer histories and not a permanently held-out test set. They cover duplicate captures, separate milestones, completed/overdue refunds, absent authorization evidence, contradictory delivery, partial fulfillment, scope changes, prompt injection and ambiguous approval. Their answer keys are excluded from model input. Once prompts are tuned against them, use separately authored cases and repeated runs for a final comparison. With a single run per case, model variability remains unknown.

## First observations

Before the evidence-gap feature, the `unauthorized-no-proof` baseline used 4,416 tokens and recommended a $900 refund from the complaint alone. Its client message incorrectly said the refund was already processed. Both quoted claims passed the quotation checker; neither that checker nor schema validation protected the uncited client message. The old shared strategy schema offered only four financial decisions and had no explicit evidence-request outcome; this was a limitation of both workflows, not evidence that the pipeline was better than the baseline.

The original agent attempt on that case used 21,581 reported tokens before an HTTP 429 (retry-after: 6 seconds) stopped it at strategy. This was a minute-limit interruption, not proof that the daily allowance was exhausted. That incomplete run is not a comparison win or loss.

After the deterministic no-evidence guard, the same agent case returns `REQUEST_MORE_EVIDENCE` with specific document requests, no financial actions, no PDFs and **zero AI requests**. This behavior is covered by offline tests. It does not establish superiority on cases containing evidence. Prompt instructions also now distinguish proposed remedies from already completed actions, but those instructions are not a semantic guarantee.

The first injection-case baseline used 5,967 tokens, acknowledged the 90 cm defect and ignored the embedded instruction. Its three quoted claims matched their sources and manual inspection supported those three claims. Its strategy chose correction while acknowledging the freelancer's fault. The paired agent attempt was interrupted during investigation after 17,832 tokens by a five-second minute-limit response. Both initial experiments had stopped on the first HTTP 429; the runner now allows the bounded short backoffs described above. These are two development observations, not completed paired evidence of an advantage.

A subsequent agent-only run completed the same injection case with the same model, prompts and documents: **32,666 tokens, 14 attempts (including one short backoff), 175 seconds**, versus the baseline's **5,967 tokens, one request, eight seconds**. Both ignored the injected instruction and acknowledged the defect. The agent chose a refund, an allowed remedy, and all eight source quotations matched. Manual review nevertheless flagged its invented "signed" agreement description and the unsupported promise that a refund would be processed immediately and arrive within the standard PayPal turnaround time. Its client message also said "I'm processing" a refund before any action. The baseline's three factual claims avoided those additions. This single development case shows no agent advantage and motivates claim-support review and tighter control of proposed-action wording. It does not establish performance across the ten-case suite.

## Next priorities

1. Finish small paired comparisons and manually review them before claiming an advantage.
2. Add claim-support review and an evidence-linked event timeline; keep quote matching distinct from inference review.
3. Add PDF text import with page references and visible extraction failures. Preserve originals.
4. Test the flow with a few consenting freelancers using anonymized past cases.
5. Improve persistence, access controls and demo reliability before judging.

Sponsor integrations should support this workflow. A larger feature list alone does not demonstrate that the agent helps.
