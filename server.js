// Web server: serves the dashboard and a small JSON API.
//
//   GET  /api/status                      what's configured (PayPal, Groq), who is signed in
//   GET  /auth/paypal                     "Log in with PayPal" (then /auth/paypal/callback)
//   POST /auth/logout                     sign out
//   GET  /api/cases?mine=ID,ID            the dispute queue (your typed-in cases + live sandbox + seeded demo disputes)
//   POST /api/custom-cases                "Try your own case": create a dispute from what you type in
//   GET  /api/cases/:id                   one dispute with its evidence locker index
//   GET  /api/cases/:id/run?mode=live     run the agent; streams the reasoning trail (Server-Sent Events)
//   GET  /api/cases/:id/run?mode=replay   play back a recorded run (for demos / when rate-limited)
//   GET  /api/cases/:id/files/:name       download a generated PDF (response letter, evidence appendix)
//   POST /api/cases/:id/submit            send the response to PayPal (real for live disputes, simulated for seeded)
//   POST /api/cases/:id/evidence          add the freelancer's own document (contract, emails, log...)
//   DELETE /api/cases/:id/evidence/:docId remove a document the freelancer added
//   POST /api/cases/:id/link              link a live sandbox dispute to a demo evidence locker
//   POST /api/cases/:id/sandbox/:action   lifecycle helpers for testing: escalate, require-evidence, adjudicate
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./src/config');
const cases = require('./src/cases');
const { buildLocker } = require('./src/evidence/locker');
const { runDefender } = require('./src/agent/defender');
const disputesApi = require('./src/paypal/disputes');
const uploads = require('./src/evidence/uploads');
const login = require('./src/paypal/login');
const customCases = require('./src/custom-cases');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', true); // Render terminates TLS in front of the app
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] })); // / is the landing page, /app the app

const REPLAY_DIR = path.join(__dirname, 'data', 'replays');
const replayPath = (id) => path.join(REPLAY_DIR, `${id.replace(/[^\w-]/g, '')}.json`);
const hasReplay = (id) => fs.existsSync(replayPath(id));

// Latest finished run per dispute (kept in memory; used by submit + file downloads).
const lastRun = new Map();
// Only one live AI run at a time: Groq's free tier allows ~8k tokens/minute in total.
let liveRunBusy = false;

// Dispute ids are short letters/digits/dashes (PP-D-27140-HALDEN, PP-R-LFT-10193672). Reject
// anything else before it can reach a PayPal URL (e.g. "../" sneaking into the path).
app.param('id', (req, res, next, id) => (/^[A-Za-z0-9-]{1,64}$/.test(id) ? next() : res.status(400).json({ error: 'Invalid dispute id' })));

// Actions that change a real PayPal dispute need a signed-in PayPal user (and, if
// LIVE_ACTION_EMAILS is set, one of those emails). Demo disputes stay open to everyone.
function canActLive(req) {
  const user = login.currentUser(req);
  const allowed = (process.env.LIVE_ACTION_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(user) && (!allowed.length || allowed.includes(String(user.email).toLowerCase()));
}
const liveActionRefused = (res) => res.status(403).json({ error: 'Sign in with PayPal to act on a real PayPal dispute.', code: 'LOGIN_REQUIRED' });

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(err.code === 'NEEDS_LINK' ? 409 : err.status || 500).json({ error: err.message, code: err.code, paypal: err.body });
});

app.get('/api/status', wrap(async (req, res) => {
  res.json({
    paypal: { enabled: config.paypal.enabled, env: config.paypal.env },
    groq: { model: config.groq.model },
    timelines: config.timelines,
    liveRunBusy,
    user: login.currentUser(req),
  });
}));

app.get('/auth/paypal', login.start);
app.get('/auth/paypal/callback', login.callback);
app.post('/auth/logout', login.logout);

// The headline of a recorded run (real complaint + plan), for the dispute list.
function replaySummary(id) {
  const rid = hasReplay(id) ? id : null;
  if (!rid) return {};
  try {
    const { events } = JSON.parse(fs.readFileSync(replayPath(rid), 'utf8'));
    const r = events.find((e) => e.type === 'result')?.payload;
    return r ? { real_summary: r.diagnosis.real_complaint.summary, decision: r.strategy.decision, refund: r.strategy.refund_amount } : {};
  } catch {
    return {};
  }
}

app.get('/api/cases', wrap(async (req, res) => {
  const mine = String(req.query.mine || '').split(',').filter((id) => customCases.isCustom(id) && /^[A-Za-z0-9-]{1,64}$/.test(id)).slice(0, 20);
  const data = await cases.listCases({ mine });
  data.cases.forEach((c) => Object.assign(c, { has_replay: hasReplay(c.dispute_id) }, replaySummary(c.dispute_id)));
  data.scenarios = cases.scenarios.map((s) => ({ id: s.id, title: s.title, freelancer: s.freelancer.name }));
  res.json(data);
}));

app.post('/api/custom-cases', wrap(async (req, res) => {
  const c = customCases.create(req.body || {});
  res.json({ ok: true, id: c.id });
}));

app.get('/api/cases/:id', wrap(async (req, res) => {
  const c = await cases.loadCase(req.params.id);
  const locker = buildLocker(c.scenario, { transactions: c.transactions, transactionsSource: c.sources.transactions });
  const { dispute, freelancer, client, title } = c.scenario;
  res.json({
    live: c.live,
    yours: Boolean(c.yours),
    title,
    fresh: Boolean(c.scenario.fresh),
    evidence_kinds: Object.fromEntries(Object.entries(uploads.KINDS).map(([k, v]) => [k, v.label])),
    freelancer,
    client,
    dispute,
    sources: c.sources,
    documents: locker.index(),
    has_replay: hasReplay(dispute.dispute_id),
    last_run: lastRun.has(dispute.dispute_id),
  });
}));

// Full text of one document (the dashboard's evidence viewer).
app.get('/api/cases/:id/documents/:docId', wrap(async (req, res) => {
  const c = await cases.loadCase(req.params.id);
  const locker = buildLocker(c.scenario, { transactions: c.transactions, transactionsSource: c.sources.transactions });
  const doc = locker.read(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  res.json(doc);
}));

// ---- The freelancer's own evidence ------------------------------------------------

app.post('/api/cases/:id/evidence', wrap(async (req, res) => {
  const c = await cases.loadCase(req.params.id);
  const taken = [...buildLocker(c.scenario, { transactions: c.transactions }).docs.keys()];
  const doc = uploads.add(req.params.id, req.body || {}, taken);
  lastRun.delete(req.params.id); // the evidence changed, so an earlier result is stale
  res.json({ ok: true, doc_id: doc.id, title: doc.title, sections: doc.sections.length });
}));

app.delete('/api/cases/:id/evidence/:docId', wrap(async (req, res) => {
  if (!uploads.remove(req.params.id, req.params.docId)) return res.status(404).json({ error: 'No such added document' });
  lastRun.delete(req.params.id);
  res.json({ ok: true });
}));

// ---- Run the agent, streaming events with Server-Sent Events --------------------

app.get('/api/cases/:id/run', async (req, res) => {
  const id = req.params.id;
  const mode = req.query.mode === 'replay' ? 'replay' : 'live';

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  let closed = false;
  req.on('close', () => {
    closed = true;
    clearInterval(keepAlive);
  });

  try {
    if (mode === 'replay') {
      if (!hasReplay(id)) throw new Error('No recorded run for this dispute yet.');
      const replay = JSON.parse(fs.readFileSync(replayPath(id), 'utf8'));
      send('mode', { mode: 'replay', recorded_at: replay.recorded_at });
      let prev = 0;
      for (const ev of replay.events) {
        if (closed) return;
        if (ev.type === 'pacing') continue; // rate-limit waits aren't worth replaying
        // Keep the original rhythm, compressed so a replay takes about a minute.
        await new Promise((r) => setTimeout(r, Math.min(1400, Math.max(250, (ev.t - prev) / 6))));
        prev = ev.t;
        // Marked as a replay so it can't be submitted to a real PayPal dispute.
        if (ev.type === 'result') lastRun.set(id, { ...ev.payload, _replay: true });
        send(ev.type, ev.payload);
      }
    } else {
      if (liveRunBusy) throw new Error('Another live run is in progress (the free AI tier allows one at a time). Try replay mode, or wait a minute.');
      liveRunBusy = true;
      try {
        send('mode', { mode: 'live' });
        const c = await cases.loadCase(id);
        const locker = buildLocker(c.scenario, { transactions: c.transactions, transactionsSource: c.sources.transactions });
        // If the viewer leaves, stop at the next step instead of spending the AI quota on
        // a run nobody will see (and holding the one-run-at-a-time lock).
        const result = await runDefender({ scenario: c.scenario, locker, sources: c.sources }, (type, payload) => {
          if (closed) throw Object.assign(new Error('Run cancelled: the page was closed.'), { code: 'CANCELLED' });
          send(type, payload);
        });
        lastRun.set(id, result);
      } finally {
        liveRunBusy = false;
      }
    }
    send('end', {});
  } catch (err) {
    if (err.code === 'CANCELLED') console.log(`${id}: ${err.message}`);
    else console.error(err);
    if (!closed) send('fatal', { message: err.message, code: err.code });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

// ---- Generated files --------------------------------------------------------------

app.get('/api/cases/:id/files/:name', (req, res) => {
  const run = lastRun.get(req.params.id);
  const file = run?.package?._files.find((f) => f.name === req.params.name);
  if (!file) return res.status(404).send('Run the agent first.');
  res.type(file.type).send(Buffer.from(file.bytes, 'base64'));
});

// ---- Submit to PayPal ---------------------------------------------------------------

app.post('/api/cases/:id/submit', wrap(async (req, res) => {
  const id = req.params.id;
  const run = lastRun.get(id);
  if (!run) return res.status(400).json({ error: 'Run the agent first.' });
  const wanted = new Set(req.body.actions || run.package.actions.map((a) => a.kind));
  const c = await cases.loadCase(id);
  const results = [];
  if (c.live && !canActLive(req)) return liveActionRefused(res);
  if (c.live && run._replay) return res.status(409).json({ error: 'This is a recorded run. Run the agent live before sending anything to a real PayPal dispute.' });

  // PayPal lists the actions allowed right now as HATEOAS links on the dispute (they change
  // with the dispute's stage), so check those before calling anything.
  const current = c.live ? await disputesApi.getDispute(id) : null;
  const allowed = c.live ? new Set((current.links || []).map((l) => l.rel)) : null;
  // Evidence types PayPal has asked the seller for (e.g. OTHER, PROOF_OF_REFUND).
  const requested = (current?.evidences || []).filter((e) => e.source === 'REQUESTED_FROM_SELLER').map((e) => e.evidence_type);

  for (const action of run.package.actions.filter((a) => wanted.has(a.kind))) {
    if (action.kind === 'email') {
      results.push({ kind: action.kind, ok: true, simulated: true, note: 'Email is sent by the freelancer from their own inbox; the text is ready to copy.' });
      continue;
    }
    if (!c.live) {
      // Seeded dispute: it doesn't exist in PayPal, so show exactly what would be sent.
      results.push({ kind: action.kind, ok: true, simulated: true, request: preview(action) });
      continue;
    }
    if (!allowed.has(action.kind)) {
      results.push({
        kind: action.kind,
        ok: false,
        skipped: true,
        error: `Not available at this stage (${c.scenario.dispute.dispute_life_cycle_stage}). PayPal currently allows: ${[...allowed].filter((r) => r !== 'self').join(', ')}.`,
      });
      continue;
    }
    try {
      let r;
      if (action.kind === 'provide_evidence') {
        // Use the agent's evidence type if PayPal asked for it; otherwise fall back to OTHER when requested.
        const input = structuredClone(action.input);
        for (const ev of input.evidences) {
          if (requested.length && !requested.includes(ev.evidence_type) && requested.includes('OTHER')) ev.evidence_type = 'OTHER';
        }
        action.input = input; // so the request preview shows what was actually sent
        r = await disputesApi.provideEvidence(id, input, run.package._files);
      }
      if (action.kind === 'send_message') r = await disputesApi.sendMessage(id, action.body.message);
      if (action.kind === 'make_offer') r = await disputesApi.makeOffer(id, action.body);
      if (action.kind === 'accept_claim') r = await disputesApi.acceptClaim(id, action.body);
      results.push({ kind: action.kind, ok: true, simulated: false, request: preview(action), response: r.data, debug_id: r.debugId });
    } catch (err) {
      results.push({ kind: action.kind, ok: false, simulated: false, request: preview(action), error: err.message, paypal: err.body });
    }
  }
  res.json({ live: c.live, results });
}));

// What the HTTP request to PayPal looks like (file bytes replaced by name and size).
function preview(action) {
  return {
    method: action.method,
    url: `${config.paypal.baseUrl}${action.path}`,
    contentType: action.contentType,
    ...(action.input ? { input: action.input, files: action.files } : {}),
    ...(action.body ? { body: action.body } : {}),
  };
}

// ---- Live-dispute helpers ---------------------------------------------------------

app.post('/api/cases/:id/link', wrap(async (req, res) => {
  cases.linkLive(req.params.id, req.body.scenario_id);
  res.json({ ok: true });
}));

app.post('/api/cases/:id/sandbox/:action', wrap(async (req, res) => {
  if (config.paypal.env !== 'sandbox') return res.status(400).json({ error: 'Sandbox only' });
  if (!canActLive(req)) return liveActionRefused(res);
  // Note: escalate is a normal Disputes API call; require-evidence and adjudicate exist only in sandbox.
  const { id, action } = req.params;
  let r;
  if (action === 'escalate') r = await disputesApi.escalate(id, 'Escalating so PayPal can review the evidence.');
  else if (action === 'require-evidence') r = await disputesApi.requireEvidence(id);
  else if (action === 'adjudicate') r = await disputesApi.adjudicate(id, req.body.outcome === 'BUYER_FAVOR' ? 'BUYER_FAVOR' : 'SELLER_FAVOR');
  else return res.status(404).json({ error: 'Unknown action' });
  res.json({ ok: true, response: r.data, debug_id: r.debugId });
}));

app.listen(config.port, () => {
  console.log(`Freelancer Defender running on http://localhost:${config.port}`);
  console.log(`PayPal: ${config.paypal.enabled ? config.paypal.env : 'not configured (seeded disputes only)'} | AI model: ${config.groq.model}`);
});
