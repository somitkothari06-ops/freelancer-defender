# AGENTS.md — start here

This is the onboarding doc for an AI coding agent (Codex, Claude Code, etc.)
picking up this project cold. Read this file first, then the two it points to.
Together they should make you as effective as a session that's been working
on this repo all day.

## What this project is

**The Freelancer Defender** — an AI agent that defends freelancers when a
client's bank reverses a payment they already earned (a "chargeback"). Built
by two people for the **PayPal AI Hackathon 2026** on Devpost.

- **Deadline: Nov 12, 2026, 12:00 pm Pacific.** Judging runs Dec 1–15, so the
  hosted demo and its API keys need to keep working through mid-December.
- **Live app:** https://freelancer-defender.onrender.com
- **Target sponsor prize:** AG Grid (a project can win at most one sponsor
  prize; AG Grid pays more than Render and the app uses AG Grid in two real
  places — see README.md's Stack section).

## Reading order

1. **[README.md](README.md)** — the architecture, the code map, the stack,
   how to run it locally, how PayPal is used. This is also what judges read.
   Accurate and current; nothing here contradicts it.
2. **[NOTES.md](NOTES.md)** — what's real vs. mocked, the hero demo scenario,
   open to-dos before submission, hackathon rules as read from Devpost. This
   is the "working notes" doc the two humans use day to day. **Has a dated
   section for each day's work** — read the most recent one first for the
   latest state.
3. **[docs/AG_STUDIO_TECHNICAL_NOTES.md](docs/AG_STUDIO_TECHNICAL_NOTES.md)**
   — deep, hard-won technical detail about the AG Studio integration (one
   feature of this app): several real bugs, their root causes, and how they
   were found. Only read this when you're touching `public/studio.js`,
   `public/studio-demo.js`, or the `/api/studio/chat` proxy in `server.js` —
   it's long and narrow, not general project context. Rediscovering any one
   of these bugs from scratch would burn hours; this doc exists so you don't
   have to.

## The two humans

Built by two people (one of whom works through Claude Code / Codex sessions
like this one — if you're reading this, you may be continuing that work).
They talk informally and want things verified, not just claimed. Specific
standing instructions that apply to **all** future work on this repo:

- **If you change anything user-visible, verify it is actually live on the
  deployed site** (https://freelancer-defender.onrender.com), not just
  working locally. This was stated explicitly and repeatedly — don't just
  trust `git push`; see "Deploying" below for why.
- When unsure about a technical claim (whether a library/model/API actually
  exists, whether a GitHub repo is legitimate, etc.), **search to confirm
  before asserting an opinion**, rather than guessing from priors. This
  project has a few first-party integrations (AG Studio, AG Grid, Bryntum,
  Groq) that aren't deeply trained into most models' knowledge — verify
  against current docs/bundles rather than assuming.
- A demo for hackathon judges must be **reliable, not just usually-correct**.
  Where a live AI call could plausibly fail in front of a judge, prefer a
  guaranteed path (a scripted replay, a pre-recorded run) alongside the live
  one, rather than replacing the live one — both value "it's real" and
  "it can't embarrass us" highly. See `public/studio-demo.js` and
  `data/replays/*.json` for two different solutions to this same problem.

## Commands

```bash
npm install
npm start                             # http://localhost:3000
npm run dev                           # same, with --watch (auto-restart)
npm test                              # node --test test/*.test.js — 18 tests, keep green
node --test scripts/test-studio-adapter.js   # AG Studio schema-transform tests (not in npm test)
npm run eval                          # score recorded replays against each scenario's answer key
npm run run-one -- PP-D-27140-HALDEN --save   # run the agent in the terminal, record a replay
npm run paypal:check                  # verify PayPal sandbox credentials/access
npm run paypal:seed -- halden-brand   # send a real sandbox invoice (see NOTES.md for the full flow)
```

Always run `npm test` after touching anything in `src/`. If you touch
`public/studio.js`, also run the adapter test above — it's the only coverage
for the JSON-Schema-to-Groq-strict-mode transform, which is subtle and has
had multiple real bugs (see the technical notes doc).

## Environment / credentials

Copy `.env.example` to `.env` and fill in:

- `GROQ_API_KEY` — required for any live AI call (free tier: Groq's
  `openai/gpt-oss-120b`). Without it, the app still runs and **Replay**
  (recorded runs) still works.
- `GROQ_MODEL` — optional, defaults to `openai/gpt-oss-120b`.
- `GROQ_STUDIO_MODEL` — optional, defaults to empty (falls back to
  `GROQ_MODEL`). Exists so the AG Studio panel could in principle use a
  different/cheaper model than the main agent; currently unused, leave it
  empty unless you've specifically verified a candidate model's token limits
  (see the technical notes doc — this bit us once).
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_ENV=sandbox` —
  optional. Without them the app runs on 4 seeded demo disputes and
  simulates submission (clearly labelled in the UI). The actual current
  values live only in `.env` (gitignored) and in Render's Environment tab —
  ask the human for them if you need to test the real PayPal integration;
  **do not** ask them to paste secret values into chat (they've already had
  to rotate credentials once this project because of that).
- `PORT` — optional, defaults to 3000.

## Deploying (Render)

- **Service:** `srv-dbbihntg1s2s7393u3dg`, live at
  https://freelancer-defender.onrender.com, branch `main`.
- **Render's `autoDeploy: yes` has repeatedly not fired reliably** after a
  push to `main` in practice (observed many times). The dependable pattern,
  every time you push something the human should see live:

  ```bash
  git push origin main
  render deploys create srv-dbbihntg1s2s7393u3dg --confirm -o json
  # then poll until the first entry's .status is "live" (or build_failed, etc.)
  render deploys list srv-dbbihntg1s2s7393u3dg -o json
  ```

  This requires the Render CLI to be authenticated in your environment —
  if it isn't, say so rather than silently skipping the deploy-and-verify
  step; a push to GitHub alone is **not** sufficient to call a change "done"
  per the standing instruction above.
- After deploying, do a real browser check (not just "the deploy status says
  live") for anything user-visible — load the actual page, click the actual
  thing. This project has a built-in-browser-capable agent workflow for
  exactly this (see the preview/browser tooling available to you, if any);
  if you have no browser tool, say so explicitly and ask the human to check,
  rather than claiming it works.

## Delegation pattern (if you are spawning sub-tasks to another agent)

This project has been developed partly by delegating well-scoped,
self-contained tasks to Codex CLI (`codex exec`) from inside a Claude Code
session, when the orchestrating session was low on its own usage budget.
If you find yourself in a similar position (spawning a sandboxed CLI agent
to do focused implementation work), the pattern that worked well:

1. Write one complete, self-contained task file (full context — the
   sub-agent has no memory of this conversation — explicit scope, which
   files to touch and not touch, concrete suggested content, exact
   validation commands to run).
2. Launch it as a single background shell command piping the task file into
   the agent's `exec`/non-interactive mode, writing its own report to a
   file you read afterwards.
3. **Never combine `&` backgrounding in the command string with a
   "run in background" flag on the tool call itself** — the combination
   causes only the wrapper to be tracked, not the actual long-running
   process, which then runs fully detached and un-awaited. This was a real,
   repeated mistake this session; use the tool's own backgrounding, not
   shell `&`, or you'll lose track of whether the task is even still running.
4. When it reports back, **read its actual diff**, don't just trust its
   prose summary. Independently run the validation commands yourself.
   A sandboxed CLI agent typically cannot run a browser or bind a port —
   reserve "does this actually render/work" checks for whichever agent
   (you, or a human) that can.

## Known, accepted limitations (not bugs to "fix" reflexively)

- The live (non-scripted) AG Studio "Ask about your disputes" panel runs on
  Groq's free-tier `openai/gpt-oss-120b`, which can occasionally fail to
  construct a correct tool call on a given attempt even after the fixes in
  the technical notes doc. This is mitigated (generous retries, correct
  system-prompt forwarding, a guaranteed scripted fallback button) but not
  eliminated for genuinely free-form questions. That's expected, not a
  regression to chase.
- Groq's free tier cap (~200,000 tokens/day for the main model) limits live
  agent runs to roughly 4 per day; replays exist specifically so demos don't
  depend on quota. See NOTES.md "Open items" for the numbers and the
  upgrade option.
- Render's free plan sleeps after ~15 min idle (first load after sleep:
  ~30–50s). Known, documented in NOTES.md, with a suggested paid-tier fix
  before judging starts.
