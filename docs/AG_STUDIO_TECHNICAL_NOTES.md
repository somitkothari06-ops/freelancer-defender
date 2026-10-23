# AG Studio integration: the technical saga

Written Oct 23, 2026, after a full day of debugging and building the "Ask
about your disputes" panel. Read [AGENTS.md](../AGENTS.md) first if you
haven't. This doc exists because every fix below took real time to find and
would be expensive to rediscover — it's reference material for anyone
touching `public/studio.js`, `public/studio-demo.js`, or the
`/api/studio/chat` route in `server.js`, not a narrative to read end to end.

## What this feature is

A natural-language panel on the dispute queue (`public/app.html`, "Ask about
your disputes" card). AG Grid's sibling product **AG Studio** provides a
chat-driven agent that can query the app's own data and build live
charts/tables in response to a free-text question — "which dispute has the
weakest evidence?", "how much have I protected this month?". Studio ships as
a drop-in web component (loaded via `<script src="…ag-studio.min.js">` in
`app.html`) that needs one thing from the host app: an **LLM adapter** — a
function that takes Studio's conversation state and tool schemas, calls an
actual model, and returns the result in Studio's expected shape. We write
that adapter; Studio does everything else (the agent loop, the query engine,
the widget rendering).

`public/studio.js` is that adapter, talking to Groq (`openai/gpt-oss-120b`)
through our own `/api/studio/chat` proxy in `server.js`, which just reuses
`src/ai/groq.js`'s existing pacing/retry logic.

## The adapter contract (reverse-engineered, then confirmed via docs)

`AgLlmAdapter.executeTurn(request, options) -> { stream, complete }`:
- `stream` is an async-iterable of Studio's own event types
  (`TEXT_MESSAGE_START/CONTENT/END`, `TOOL_CALL_START/ARGS/END`, …).
- `complete` is a `Promise` resolving to the full `AgLlmResponse` once the
  turn is done (`{ id, createdAt, status, output, usage }`).

`request.input` is Studio's own conversation-item format (not raw OpenAI
messages) — user/assistant messages, function calls, function call outputs.
`request.tools` is an array of `{ name, description, parameters }` where
`parameters` is a **JSON Schema draft 2020-12** object. `request.instructions`
is Studio's own per-turn system prompt (see bug #2 below).

Since we're calling an OpenAI-compatible API (Groq) underneath, the adapter's
job is almost entirely **translation**: Studio's conversation items → OpenAI
chat `messages`; Studio's JSON-Schema-2020-12 tool parameter schemas →
Groq's **strict-mode** tool schemas (a much more restrictive subset); and
Groq's chat-completion response → Studio's streamed events + final response.
`public/studio.js`'s `encodeInput`/`encodeTools`/`encodeToolChoice`/
`encodeResponseFormat` do the first direction; `decodeToResponseAndEvents`
does the last. The official reference (OpenAI adapter example) is at
https://ag-grid.com/studio/react/ai-adapter.md — worth re-reading if Studio
changes its contract in a future version bump.

## Bug 1: the JSON-Schema-2020-12 → Groq-strict-mode transform

This is the bulk of `public/studio.js` (`transformSchema` and its helpers,
lines ~20–254) and was the single largest source of bugs. Groq's strict tool
mode is much pickier than plain JSON Schema:

- Every object needs `additionalProperties: false` and **every** property
  listed in `required` (optional fields are modeled as `anyOf: [type, null]`
  instead of omission — see `makeNullable`).
- `anyOf` branches must be "disambiguated" — Groq's own discriminator
  inference looks for one shared `required` enum property across all
  branches; with zero or more-than-one such candidate it behaves
  differently (see `objectsAreDisjoint`, which mirrors this inference so we
  know in advance whether Groq will accept a given `anyOf` as-is).
- `$ref` branches inside an `anyOf` being treated as a discriminated union
  must be **fully inlined**, never left as a bare ref, even when the ref
  would otherwise cleanly disambiguate (`resolveRef`).
- A handful of JSON Schema keywords Groq doesn't support at all
  (`allOf`, `not`, `oneOf`, `if`/`then`/`else`, `patternProperties`, etc. —
  the `unsupportedKeywords` list) — AG Studio's schemas don't use these in
  practice, but the code throws a clear error if one shows up rather than
  silently mis-translating it.
- A bare `anyOf` nested directly inside another `anyOf` (Studio emits this
  shape for some unions, e.g. `AgApiExpression`) must be **flattened**, not
  left nested (`flattenNestedAnyOf`) — Groq rejects nested-bare-anyOf
  outright.
- Multiple plain-object `anyOf` branches that **aren't** disjoint by any
  discriminator get **merged into one object** with every possible property
  made nullable (`flattenObjects`), rather than left as an undisambiguatable
  union Groq would reject. This necessarily widens what the model is
  *allowed* to send in the tool call — but Studio's own engine still
  validates the actual call when it runs, so an invalid combination is
  caught there, not silently accepted.
- Same idea for primitive `anyOf` branches that share a type
  (`mergePrimitives`): an unconstrained `string` branch subsumes a
  `string` + `enum` branch, so they merge into one wider branch rather than
  leaving two indistinguishable string options.
- `$ref`s that resolve to a plain string enum (e.g. a field-id enum like
  `AgExpressionOperator`) need to be **inlined** as `{type: 'string', enum}`
  when used alongside `null` — Groq won't treat a bare `$ref` next to `null`
  as disambiguated the way it treats an inline enum next to `null`
  (`asStringEnum`, used inside `makeNullable`).

All of this has a cycle guard (`resolving: Set<string>` threaded through
every recursive helper) because AG Studio's own schema defs are sometimes
self-referential (e.g. a tree-shaped filter expression) — resolving a `$ref`
fully is necessary in several of the cases above, but resolving a *cyclic*
one fully would recurse forever, so a definition already being expanded
higher up the call chain is left as a bare `$ref` instead of re-expanded.

**If this breaks again**: the fastest diagnostic is the actual Groq 400
error body (`err.groq` in `src/ai/groq.js`'s `chat()` — e.g. "anyOf branches
must be disambiguated...", "properties must be present...") — it names the
exact rule being violated, which maps directly onto one of the helpers
above. `scripts/test-studio-adapter.js` has the regression tests; run it
with `node --test scripts/test-studio-adapter.js` (not part of `npm test`).

Do not touch this transform without strong reason — it is now stable and
covers every schema shape AG Studio's current tool set emits.

## Bug 2: `request.instructions` was silently dropped

Studio's `executeTurn(request, …)` passes its own per-turn system prompt as
`request.instructions` — confirmed against AG Studio's own adapter docs
(https://ag-grid.com/studio/react/ai-adapter.md). The first version of
`encodeInput` only translated `request.input` (the conversation items) and
ignored `request.instructions` entirely, so the model never received
Studio's actual task framing — just the raw conversation. **No error
surfaced anywhere**; the symptom was just a model that behaved like it
didn't understand what it was supposed to be doing.

Fix (`public/studio.js`, `encodeInput`): prepend it as a `system` message
when present:

```js
function encodeInput(items, instructions) {
  const messages = [];
  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({ role: 'system', content: instructions });
  }
  // ...then the translated conversation items
}
```

Covered by adapter tests added alongside the fix.

## Bug 3: shared rate-limit budget across different models

`src/ai/groq.js` paces calls against Groq's per-model token-per-minute
budget, learned from response headers. The original code kept this state in
one module-level object (`budget`), shared across **every** model name used
in the process. Once the AG Studio feature introduced the possibility of a
second model (`config.groq.studioModel`, distinct from the main agent's
`config.groq.model`), a single shared budget meant one model's learned
pacing got applied to the other — either waiting too long, or not long
enough and hitting 429s.

Fix: `budgets = new Map()` keyed by model name, with a `budgetFor(model)`
accessor (`src/ai/groq.js` lines ~13–17). This is a real correctness fix
independent of whether `GROQ_STUDIO_MODEL` is ever actually set to something
different — worth keeping even though the studio model currently falls back
to the same model as the main agent.

Also bumped in the same pass: the retry budget for Groq's `tool_use_failed`
/ `output_parse_failed` "flaky" errors, from 3 total attempts to 6
(`attempt < 6` in the flaky-retry check, outer loop ceiling `attempt <= 6`
to match). AG Studio's tool schemas are larger and more complex than the
main agent's, so the free-tier model glitches on them more often; more
retries measurably improved reliability without materially slowing down a
normal run (retries only trigger on an actual glitch, not every call).

## Bug 4: `complete_task` requires BOTH `summary` and `artifacts`

This is the one that cost the most real time, and is the most likely
explanation for essentially every "the delegate finished without a summary"
failure seen across the entire day's live testing, in both the scripted
demo work and ordinary live use.

**How it was found**: AG Studio ships as a minified UMD bundle
(`https://cdn.jsdelivr.net/npm/ag-studio@3.0.0/dist/umd/ag-studio.min.js`,
same version pinned in `app.html`). There is no public schema reference for
Studio's internal tool set (`delegate_to`, `view_schema`, `execute_query`,
`add_widget`, `configure_widget`, `complete_task`, …) beyond what the model
discovers at runtime via the tool definitions Studio itself sends. To find
out exactly what `complete_task` requires, the bundle was fetched directly
in a browser session and searched with plain string operations
(`.indexOf()` / `.slice()` around the known internal name) rather than
guessed from the tool-call errors alone. That search turned up the actual
Zod-equivalent validator Studio runs internally:

```
Zni = e.object({ summary: e.string()..., artifacts: e.array(...) })
```

Both fields present, **neither marked optional**. A hand-crafted test call
with just `{ summary }` (no `artifacts`) reproduced the exact "finished
without a summary" symptom immediately. Adding `artifacts: []` fixed it,
confirmed by two clean end-to-end runs with correct output.

**Where this is applied**: the scripted demo
(`public/studio-demo.js`) always sends `artifacts: []` on its
`complete_task` call — see the comment directly above that call in the
source, which records this exact finding. **This was not fixed on the live
(model-driven) path** — we didn't change what we *send* the model (the tool
schema already correctly marks `artifacts` as required; the strict-mode
transform in bug #1 should enforce that Groq cannot omit a required field).
The live model may still occasionally construct a `complete_task` call
without a sensible `artifacts` value for other reasons (a genuine model
mistake, not a schema-encoding bug) — if "finished without a summary"
resurfaces on a **live, non-scripted** run, re-check this exact hypothesis
first before assuming it's something new: capture the actual tool-call
arguments Studio received and confirm `artifacts` is present and is an
array.

**Technique worth reusing**: fetching and grepping Studio's own bundle this
way is the reliable way to answer "what does this internal tool actually
require/accept" when Studio's public docs don't say. It's slow (binary-
search through a huge minified file) but ground-truth, unlike guessing from
error messages alone.

## Bug 5: a plausible-but-wrong Groq model for the Studio proxy

Early in trying to make the Studio panel more reliable, a candidate model
(`qwen/qwen3.8-27b`) was considered for `GROQ_STUDIO_MODEL` — the idea being
a different, perhaps more tool-call-reliable model just for this panel. It
**is** a real, currently-available Groq model (confirmed via a live
`/v1/models` call, not just assumed) — but its free-tier limit is **7,000
input-tokens-per-minute**, smaller than a single AG Studio request's typical
payload (~9,200 tokens, given the large system prompt plus the full tool
schema set). Every call failed immediately with a 413 "request too large,"
categorically, regardless of pacing — this isn't a rate-limit-backoff
problem, the single request itself doesn't fit.

Reverted: `GROQ_STUDIO_MODEL` is currently empty in `.env`, which makes
`config.groq.studioModel` fall back to `config.groq.model`
(`openai/gpt-oss-120b`, the same model the main agent uses, whose free tier
accommodates the larger payload). **If revisiting this**: check a
candidate's per-minute *input* token limit against the actual payload size
Studio sends (not just that the model exists and responds to small
requests) before wiring it in.

## The guaranteed-reliable scripted demo

Given the live path's residual unreliability (bug #4's open tail, ordinary
model variance on a genuinely free-form question), and an explicit ask for
"a perfect demo, nothing on certainty," `public/studio-demo.js` plus
`replayAdapter()`/`lastToolResult()` in `public/studio.js` implement a
second mode: a **pre-scripted** conversation for one fixed question
("Which dispute has the largest amount?"), triggered by the "▶ Watch an
example" button in `app.html` next to the live "Ask a question" toggle.

How it stays honest rather than faked: only the **choice of which tool to
call next** is scripted (a fixed array of steps). The query itself
(`execute_query` with a real, verified-correct `apiQuery` projection/sort/
limit) is a genuine call into Studio's real query engine over the real
dispute data — and the final `complete_task` summary is built from
`lastToolResult(request)`, which pulls the actual tool result Studio's
engine just returned, not a hard-coded number. So the numbers on screen are
always live data; only the *decision of what to click next* is
pre-determined. A step in the script may be a plain object (fixed message)
or a function of the live `request` (to react to real data) —
`replayAdapter(script, fallback)` handles both. Once the script is
exhausted, it falls through to a real `groqAdapter()` (`fallback`, built
lazily), so the same Studio instance that just played the guaranteed demo
can keep answering genuine follow-up questions live afterward.

**Why no widget-building step**: AG Studio's `add_widget`/`configure_widget`
tool calls were examined in the same bundle-reading pass as bug #4, but
`configure_widget`'s schema is polymorphic per widget type and wasn't fully
reverse-engineered — getting the exact shape right blind, with no way to
render and check it outside a live Studio session, was judged too risky for
a guaranteed demo path. The shipped script ends in a plain-text answer
instead. If someone wants to extend the demo to show a live chart/table
being built, that reverse-engineering (same bundle-fetch-and-grep technique
as bug #4) is the remaining work — budget real time for it and verify in an
actual browser before trusting it, the same way bug #4's fix was verified.

## Judge-mode real-time stage narration (a separate, simpler feature)

Not an AG Studio feature, but built the same day for the same "judges need
to see what's happening" goal: `public/app.js`'s `STAGE_EXPLANATIONS` +
`showStageNarration()`/`endStageNarration()`. In judge mode
(`state.keepStagesOpen`, the `#/judge` auto-play route), as each of the
agent's 8 reasoning stages starts, a spotlight-and-card UI automatically
highlights the live stage and shows a plain-language explanation of what
it's doing — reusing the first-visit tour's visual language
(`.tour-spot`/`.tour-tip` in `public/styles.css`) under its own CSS classes
(`.stage-narration*`) so the two features stay independent. Fully gated on
`state.keepStagesOpen`, so a normal (non-judge) live run is unaffected; no
"Skip"/"Next" buttons since nothing needs a click — it plays and advances
automatically with the stage stream. Verified live on production
(https://freelancer-defender.onrender.com/app.html#/judge) via browser
screenshot on Oct 23, 2026.

## General lessons for whoever works on this next

1. **Studio's real behavior lives in its bundle, not in any doc.** When a
   tool-call shape, a required field, or an error is unclear, fetch
   `https://cdn.jsdelivr.net/npm/ag-studio@3.0.0/dist/umd/ag-studio.min.js`
   (match the version pinned in `app.html`) and search it directly rather
   than guessing. This found bug #4 and the exact internal validator shape.
2. **Verify a model's real limits (not just existence) before wiring it
   in** — a live `/v1/models` call confirms a model exists; it does not
   confirm its free-tier token budget actually fits this app's payloads
   (bug #5).
3. **A schema-encoding bug and a model-behavior bug look identical from the
   outside** ("the delegate finished without a summary" was both, at
   different times, for different underlying reasons) — when debugging a
   Studio failure, check both: is the schema we're sending actually correct
   (reproduce with a hand-crafted call bypassing the model), and separately,
   is the live model's actual behavior correct given a correct schema.
4. **For a live demo in front of judges, "usually correct" isn't good
   enough** — prefer adding a guaranteed path alongside a live one (scripted
   replay, recorded run) over trying to make the live path itself
   100% reliable, which may not be achievable against a free-tier model.
