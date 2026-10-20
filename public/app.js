// Freelancer Defender dashboard.
// Plain JavaScript, no build step. Two views:
//   #/            the dispute queue (AG Grid)
//   #/case/<id>   one dispute: deadline clock, evidence locker, and the live reasoning trail
'use strict';

// ---------- helpers -------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const fmtMoney = (n, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
};

const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Service not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate',
  INCORRECT_AMOUNT: 'Incorrect amount',
  OTHER: 'Other',
};
const DECISIONS = {
  CONTEST: 'Contest on the evidence',
  CONTEST_AND_RESOLVE: 'Contest the reversal + fix the real problem',
  PARTIAL_REFUND_AND_CONTEST: 'Refund what is owed, contest the rest',
  ACCEPT_AND_REFUND: 'Accept: the client is right',
};

function timeLeft(due) {
  // No due date means PayPal isn't waiting on the freelancer right now (e.g. under review).
  if (!due) return { ms: Infinity, hrs: Infinity, text: 'Not waiting on you', short: 'No deadline' };
  const ms = new Date(due) - Date.now();
  if (ms <= 0) return { ms: 0, text: 'Expired' };
  const hrs = Math.floor(ms / 3.6e6);
  const min = Math.floor((ms % 3.6e6) / 6e4);
  const sec = Math.floor((ms % 6e4) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return { ms, hrs, text: `${pad(hrs)}:${pad(min)}:${pad(sec)}`, short: `${hrs}h ${pad(min)}m` };
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---------- app state -------------------------------------------------------------

const state = {
  status: null,
  queue: null,
  grid: null,
  current: null, // the case being viewed
  stream: null, // active EventSource
  clockTimer: null,
};

// ---------- routing -------------------------------------------------------------

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  $('#drawer-close').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
  state.status = await api('/api/status').catch(() => null);
  renderStatus();
  route();
});

function route() {
  const m = location.hash.match(/^#\/case\/(.+)$/);
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  clearInterval(state.clockTimer);
  if (m) openCase(decodeURIComponent(m[1]));
  else openQueue();
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  $('#status').innerHTML = `
    <span class="pill ${s.paypal.enabled ? 'on' : 'warn'}"><span class="dot"></span>PayPal ${s.paypal.enabled ? esc(s.paypal.env) : 'not connected'}</span>
    <span class="pill on"><span class="dot"></span>${esc(s.groq.model)} on Groq</span>`;
}

// ================================================================================
// Queue view
// ================================================================================

async function openQueue() {
  $('#view-case').classList.add('hidden');
  $('#view-queue').classList.remove('hidden');
  $('#crumbs').innerHTML = 'Dispute queue';
  document.title = 'Freelancer Defender';

  const data = await api('/api/cases');
  state.queue = data;
  const rows = data.cases;

  // Headline numbers.
  const atRisk = rows.reduce((n, r) => n + r.amount, 0);
  const soonest = rows.map((r) => timeLeft(r.due)).filter((t) => Number.isFinite(t.ms)).sort((a, b) => a.ms - b.ms)[0];
  $('#queue-stats').innerHTML = `
    <div class="stat"><div class="label">Earned money at risk</div><div class="value">${fmtMoney(atRisk)}</div></div>
    <div class="stat"><div class="label">Open disputes</div><div class="value">${rows.length}</div></div>
    <div class="stat danger"><div class="label">Next deadline in</div><div class="value">${soonest ? esc(soonest.short) : '—'}</div></div>`;

  // PayPal connection banner.
  const pp = data.paypal;
  $('#paypal-banner').innerHTML = pp.error
    ? `<div class="banner warn"><strong>PayPal sandbox error:</strong> ${esc(pp.error)}</div>`
    : pp.enabled
      ? ''
      : `<div class="banner"><strong>Demo mode.</strong> PayPal credentials aren't configured, so the queue shows seeded disputes (in PayPal's exact API format) and submissions are simulated. Add sandbox credentials to pull real disputes from PayPal's Resolution Center.</div>`;

  const columnDefs = [
    {
      headerName: 'Time left',
      field: 'due',
      width: 150,
      sort: 'asc',
      comparator: (a, b) => (a ? new Date(a) : Infinity) - (b ? new Date(b) : Infinity),
      cellRenderer: (p) => {
        const t = timeLeft(p.value);
        const windowMs = new Date(p.value) - new Date(p.data.created);
        const pct = Number.isFinite(t.ms) ? Math.max(0, Math.min(100, (t.ms / windowMs) * 100)) : 0;
        return `<div class="timeleft ${t.hrs < 12 ? 'urgent' : ''}"><span>${esc(t.short || t.text)}</span><span class="bar"><i style="width:${pct}%"></i></span></div>`;
      },
    },
    {
      headerName: 'Client',
      field: 'client',
      flex: 1.2,
      minWidth: 200,
      cellRenderer: (p) => `<div class="cell-stack"><span>${esc(p.value)}</span><span class="sub">${esc(p.data.title)}</span></div>`,
    },
    {
      headerName: 'Freelancer',
      field: 'freelancer',
      width: 150,
    },
    {
      headerName: 'Filed reason',
      field: 'reason',
      width: 170,
      valueFormatter: (p) => REASONS[p.value] || p.value,
      cellRenderer: (p) => `<span class="badge">${esc(REASONS[p.value] || p.value)}</span>`,
    },
    {
      headerName: 'Amount',
      field: 'amount',
      width: 120,
      type: 'rightAligned',
      valueFormatter: (p) => fmtMoney(p.value, p.data.currency),
      cellStyle: { fontVariantNumeric: 'tabular-nums', fontWeight: 600, justifyContent: 'flex-end' },
    },
    {
      headerName: 'Paid on',
      field: 'paid_on',
      width: 130,
      valueFormatter: (p) => fmtDate(p.value),
    },
    {
      headerName: 'Stage',
      field: 'stage',
      width: 130,
      cellRenderer: (p) => `<span class="faint">${esc(p.value === 'CHARGEBACK' ? 'Chargeback' : p.value)}</span>`,
    },
    {
      headerName: 'Source',
      field: 'source',
      width: 120,
      cellRenderer: (p) =>
        p.value === 'live' ? '<span class="badge live">PayPal live</span>' : '<span class="badge demo">Demo data</span>',
    },
  ];

  if (state.grid) state.grid.setGridOption('rowData', rows);
  else {
    state.grid = agGrid.createGrid($('#grid'), {
      columnDefs,
      rowData: rows,
      defaultColDef: { sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true },
      rowHeight: 60,
      domLayout: 'autoHeight',
      animateRows: true,
      onRowClicked: (e) => (location.hash = `#/case/${encodeURIComponent(e.data.dispute_id)}`),
      overlayNoRowsTemplate: '<span class="muted">No open disputes. Every payment you earned is safe.</span>',
    });
    // Keep the "time left" column ticking.
    setInterval(() => state.grid?.refreshCells({ columns: ['due'], force: true }), 30000);
  }
}

// ================================================================================
// Case view
// ================================================================================

async function openCase(id) {
  $('#view-queue').classList.add('hidden');
  $('#view-case').classList.remove('hidden');
  window.scrollTo(0, 0);
  $('#trail').innerHTML = '';
  $('#mode-banner').innerHTML = '';
  $('#controls').innerHTML = '';

  let c;
  try {
    c = await api(`/api/cases/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.data?.code === 'NEEDS_LINK') return renderLinkPicker(id);
    $('#case-head').innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
    return;
  }
  state.current = { id, ...c, docTitles: Object.fromEntries(c.documents.map((d) => [d.doc_id, d.title])) };
  document.title = `${c.client.company} - Freelancer Defender`;
  $('#crumbs').innerHTML = `<a href="#/">Dispute queue</a> &nbsp;/&nbsp; ${esc(c.dispute.dispute_id)}`;

  renderCaseHead(c);
  renderClock(c);
  renderStatement(c);
  renderLocker(c);
  renderControls(c);
  renderTrailSkeleton();
}

async function renderLinkPicker(id) {
  const data = state.queue || (await api('/api/cases'));
  $('#case-head').innerHTML = '';
  $('#clock').innerHTML = '';
  $('#controls').innerHTML = `
    <div class="card" style="max-width:640px">
      <h4>Link this live PayPal dispute to an evidence locker</h4>
      <p class="muted">PayPal holds the dispute and the payment records. The contract, emails and delivery logs live with the freelancer. Pick the locker that belongs to this job.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${data.scenarios.map((s) => `<button class="btn" data-sc="${esc(s.id)}">${esc(s.freelancer)}: ${esc(s.title)}</button>`).join('')}
      </div>
    </div>`;
  $('#controls').querySelectorAll('[data-sc]').forEach((b) => {
    b.onclick = async () => {
      await api(`/api/cases/${encodeURIComponent(id)}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: b.dataset.sc }),
      });
      openCase(id);
    };
  });
}

function renderCaseHead(c) {
  const d = c.dispute;
  $('#case-head').innerHTML = `
    <div>
      <h1>${esc(c.client.company)} vs. ${esc(c.freelancer.business)}</h1>
      <div class="meta">
        <span class="badge">${esc(REASONS[d.reason] || d.reason)}</span>
        <span class="badge">${esc(d.dispute_channel === 'EXTERNAL' ? 'Bank chargeback' : 'PayPal dispute')}</span>
        ${c.live ? '<span class="badge live">Live from PayPal sandbox</span>' : '<span class="badge demo">Demo data in PayPal API format</span>'}
        <span>${esc(c.freelancer.name)}, ${esc(c.freelancer.craft)}</span>
        <span class="faint mono">${esc(d.dispute_id)}</span>
      </div>
    </div>
    <div class="amount">${fmtMoney(Number(d.dispute_amount.value), d.dispute_amount.currency_code)}<span class="sub">already earned, now reversed</span></div>`;
}

// The asymmetry clock: everyone else's timeline vs. the freelancer's.
function renderClock(c) {
  const d = c.dispute;
  const tl = state.status?.timelines || { bankDecisionDays: 90, cardholderFilingDays: 120 };
  if (!d.seller_response_due_date) {
    $('#clock').innerHTML = `<div class="countdown"><div class="label">Your time to respond</div><div class="digits" style="color:var(--muted)">No deadline</div><div class="sub">PayPal status: ${esc(d.status)} (${esc(d.dispute_life_cycle_stage)})</div></div><div></div>`;
    return;
  }
  const windowH = (new Date(d.seller_response_due_date) - new Date(d.create_time)) / 3.6e6;
  const longest = tl.cardholderFilingDays * 24;
  const pctYou = (windowH / longest) * 100;
  const paid = d.disputed_transactions?.[0]?.create_time;
  const daysSincePaid = paid ? Math.round((new Date(d.create_time) - new Date(paid)) / 8.64e7) : null;

  $('#clock').innerHTML = `
    <div class="countdown">
      <div class="label">Your time to respond</div>
      <div class="digits" id="digits">--:--:--</div>
      <div class="sub">due ${esc(new Date(d.seller_response_due_date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>
    </div>
    <div class="tracks">
      <div class="track client"><div class="name"><b>Client</b> could file for up to ${tl.cardholderFilingDays} days${daysSincePaid ? ` <span class="faint">(filed on day ${daysSincePaid})</span>` : ''}</div><div class="rail"><div class="fill" style="width:100%"></div></div></div>
      <div class="track bank"><div class="name"><b>Their bank</b> can take up to ${tl.bankDecisionDays} days to decide</div><div class="rail"><div class="fill" style="width:${(tl.bankDecisionDays / tl.cardholderFilingDays) * 100}%"></div></div></div>
      <div class="track you"><div class="name"><b>You</b> get ${Math.round(windowH)} hours</div><div class="rail"><div class="fill" style="width:${pctYou}%"></div><span class="callout" style="left:calc(${pctYou}% + 10px)">← that's this. ${Math.round(windowH)} hours.</span></div></div>
    </div>`;
  const tick = () => {
    const el = $('#digits');
    if (el) el.textContent = timeLeft(d.seller_response_due_date).text;
  };
  tick();
  state.clockTimer = setInterval(tick, 1000);
}

function renderStatement(c) {
  const d = c.dispute;
  // Real PayPal disputes keep the complaint in each item's notes; follow-ups are messages.
  const itemNotes = (d.disputed_transactions || []).flatMap((t) => (t.items || []).map((i) => i.notes).filter(Boolean));
  const msg = [...new Set([...itemNotes, ...(d.messages || []).filter((m) => m.posted_by === 'BUYER').map((m) => m.content)])].join('\n\n');
  $('#statement').innerHTML = `
    <div class="reason-line">
      <span class="badge accent">${esc(REASONS[d.reason] || d.reason)}</span>
      ${d.external_reason_code ? `<span class="badge">Network code ${esc(d.external_reason_code)}</span>` : ''}
    </div>
    <blockquote class="quote" id="statement-quote">${esc(msg)}</blockquote>
    <div class="faint" style="font-size:12px;margin-top:8px">Source: ${esc(c.sources.dispute)}</div>`;
}

function renderLocker(c) {
  $('#locker-count').textContent = `${c.documents.length} documents`;
  const ul = $('#locker');
  ul.innerHTML = '';
  for (const d of c.documents) {
    const li = h(`
      <li data-doc="${esc(d.doc_id)}" title="${esc(d.summary)}">
        <span class="ld"></span>
        <span>
          <div class="lt">${esc(d.title)}</div>
          <div class="ls">${d.kind === 'paypal_record' ? '<span class="src-tag">PayPal API</span> · ' : ''}${esc(d.source)}</div>
        </span>
        <span class="lc" data-count>${d.sections}</span>
      </li>`);
    li.onclick = () => openDrawer(d.doc_id);
    ul.appendChild(li);
  }
}

function markDoc(docId, cls) {
  const li = $(`#locker li[data-doc="${CSS.escape(docId)}"]`);
  if (!li) return;
  li.classList.add(cls);
  li.classList.remove('pulse');
  void li.offsetWidth; // restart the animation
  li.classList.add('pulse');
}

function renderControls(c) {
  const ctl = $('#controls');
  ctl.innerHTML = `
    <button class="btn primary" id="run-live">Run the defender (live AI)</button>
    <button class="btn" id="run-replay" ${c.has_replay ? '' : 'disabled title="No recorded run yet"'}>Replay a recorded run</button>
    <span class="faint" style="font-size:12px">Live runs call ${esc(state.status?.groq.model || 'the model')}; on Groq's free tier they take a few minutes.</span>`;
  $('#run-live').onclick = () => startRun('live');
  $('#run-replay').onclick = () => startRun('replay');

  // Live sandbox disputes: buttons to move the dispute through PayPal's lifecycle while testing.
  if (c.live && state.status?.paypal.env === 'sandbox') {
    const tools = h(`<div class="toolrow" style="width:100%"><span class="verb">sandbox</span>
        <span class="faint">${esc(c.dispute.dispute_life_cycle_stage)} · ${esc(c.dispute.status)}</span>
        <button class="btn" data-a="escalate">Escalate to claim</button>
        <button class="btn" data-a="require-evidence">Require seller evidence</button>
        <button class="btn" data-a="adjudicate" data-o="SELLER_FAVOR">Settle: freelancer wins</button>
      </div>`);
    tools.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/cases/${encodeURIComponent(c.dispute.dispute_id)}/sandbox/${b.dataset.a}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outcome: b.dataset.o }),
          });
          toast(`${b.textContent}: done. PayPal can take a minute to update.`);
        } catch (err) {
          toast(`${b.textContent}: ${err.data?.paypal?.details?.[0]?.issue || err.message}`);
        }
      };
    });
    ctl.appendChild(tools);
  }
}

// ---------- the reasoning trail -------------------------------------------------

const STAGES = [
  ['intake', 'Pull the dispute from PayPal', 'Disputes API + Transaction Search API'],
  ['read', 'Read the complaint', 'what they literally say vs. what is vague'],
  ['investigate', 'Investigate the evidence', 'the agent opens documents and records findings'],
  ['diagnose', 'Find the real complaint', 'competing hypotheses, weighed against evidence'],
  ['strategy', 'Choose a strategy', 'answer the bank and fix the real problem'],
  ['draft', 'Draft the response', 'every claim must cite an exact source'],
  ['verify', 'Verify every citation', 'deterministic check, no AI'],
  ['package', 'Send through PayPal', 'provide-evidence / make-offer / send-message'],
];

function renderTrailSkeleton() {
  const ol = $('#trail');
  ol.innerHTML = '';
  for (const [key, title, sub] of STAGES) {
    ol.appendChild(
      h(`<li class="stage pending" data-stage="${key}">
          <span class="node"></span>
          <div class="stage-head"><span class="stage-title">${esc(title)}</span><span class="stage-sub">${esc(sub)}</span></div>
          <div class="stage-body"></div>
        </li>`)
    );
  }
}

const stageEl = (key) => $(`#trail [data-stage="${key}"]`);
const stageBody = (key) => $('.stage-body', stageEl(key));
function setStage(key, status) {
  const el = stageEl(key);
  if (!el) return;
  el.classList.remove('pending', 'running', 'done');
  el.classList.add(status === 'start' ? 'running' : 'done');
  if (status === 'start') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function chip(c, kind = '') {
  const isPP = c.doc_id === 'DISPUTE' || c.doc_id === 'PAYPAL-TXN';
  const el = h(`<button class="chip ${isPP ? 'paypal' : ''} ${kind}" title="${esc(state.current?.docTitles[c.doc_id] || c.doc_id)}">${esc(c.doc_id)} · ${esc(c.anchor)}</button>`);
  el.onclick = () => openDrawer(c.doc_id, c.anchor, c.quote);
  return el;
}
function chips(list, kind) {
  const wrap = h('<div class="chips"></div>');
  (list || []).forEach((c) => wrap.appendChild(chip(c, kind)));
  return wrap;
}

function startRun(mode) {
  if (state.stream) state.stream.close();
  renderTrailSkeleton();
  $('#locker').querySelectorAll('li').forEach((li) => li.classList.remove('opened', 'cited'));
  $('#run-live').disabled = true;
  $('#run-replay').disabled = true;
  let currentStage = 'intake';

  const es = new EventSource(`/api/cases/${encodeURIComponent(state.current.id)}/run?mode=${mode}`);
  state.stream = es;
  const on = (type, fn) => es.addEventListener(type, (e) => fn(JSON.parse(e.data)));

  on('mode', (p) => {
    $('#mode-banner').innerHTML =
      p.mode === 'replay'
        ? `<div class="banner">Replaying a recorded <strong>live</strong> run from ${esc(new Date(p.recorded_at).toLocaleString())}, sped up. Same model output, nothing staged.</div>`
        : `<div class="banner">Live run: <strong>${esc(state.status?.groq.model)}</strong> is reasoning right now.</div>`;
  });

  on('stage', (p) => {
    currentStage = p.stage;
    setStage(p.stage, p.status);
    if (p.status === 'done') renderStageDone(p.stage, p.data || {}, p.thinking);
  });
  on('thinking', (p) => addThinking(p.stage, p.text));
  on('tool', (p) => {
    const body = stageBody('investigate');
    if (p.name === 'read_document') {
      markDoc(p.doc_id, 'opened');
      body.appendChild(h(`<div class="toolrow"><span class="verb">open</span><span class="obj">${esc(p.title)}</span><span class="hits">${p.sections.length} sections · ${esc(p.source)}</span></div>`));
    } else if (p.name === 'search_evidence') {
      body.appendChild(h(`<div class="toolrow"><span class="verb">search</span><span class="obj">"${esc(p.query)}"</span><span class="hits">${p.hits.length} matches</span></div>`));
    }
  });
  on('finding', (p) => {
    p.citations.forEach((c) => markDoc(c.doc_id, 'cited'));
    const card = h(`<div class="card finding"><div class="f-text">${esc(p.finding)}</div><div class="f-why">${esc(p.significance)}</div></div>`);
    card.appendChild(chips(p.citations));
    stageBody('investigate').appendChild(card);
  });
  on('pacing', (p) => {
    const body = stageBody(currentStage);
    const el = h(`<div class="pacing"><span class="spin"></span>Pausing ${Math.round(p.ms / 1000)}s for the ${esc(p.reason)}</div>`);
    body.appendChild(el);
    setTimeout(() => el.remove(), p.ms);
  });
  on('verify_issue', (p) => {
    const body = stageBody('verify');
    const card = h(`<div class="card"><h4>${p.failed.length} claim(s) failed the citation check, sending back to the model to repair</h4></div>`);
    const list = h('<div class="thinking"></div>');
    p.failed.forEach((f) => list.appendChild(h(`<div>✗ "${esc(f.text)}"\n   ${esc(f.problems.join('; ') || 'no citation')}</div>`)));
    const toggle = h('<button class="think-toggle">▸ show which claims and why</button>');
    toggle.onclick = () => list.classList.toggle('open');
    card.append(toggle, list);
    body.appendChild(card);
  });
  on('result', (r) => renderResult(r));
  on('fatal', (p) => {
    stageBody(currentStage).appendChild(h(`<div class="banner warn"><strong>Stopped:</strong> ${esc(p.message)}</div>`));
    finish();
  });
  on('end', finish);
  es.onerror = () => finish();

  function finish() {
    es.close();
    state.stream = null;
    $('#run-live').disabled = false;
    $('#run-replay').disabled = !state.current.has_replay;
  }
}

function addThinking(stage, text) {
  if (!text) return;
  const body = stageBody(stage);
  if (!body) return;
  const btn = h('<button class="think-toggle">▸ model scratchpad</button>');
  const box = h(`<div class="thinking">${esc(text)}</div>`);
  btn.onclick = () => {
    box.classList.toggle('open');
    btn.textContent = `${box.classList.contains('open') ? '▾' : '▸'} model scratchpad`;
  };
  body.appendChild(btn);
  body.appendChild(box);
}

function renderStageDone(stage, data, thinking) {
  const body = stageBody(stage);
  if (stage === 'intake') {
    body.appendChild(
      h(`<div class="card"><div class="kv">
          <span class="k">Dispute</span><span>${esc(data.sources.dispute)}</span>
          <span class="k">Payment history</span><span>${esc(data.sources.transactions)}</span>
          <span class="k">Evidence locker</span><span>${data.documents.length} documents, ${data.documents.reduce((n, d) => n + d.sections, 0)} citable sections</span>
        </div></div>`)
    );
  }

  if (stage === 'read') {
    const card = h(`<div class="card"><h4>Stated complaint</h4><div>${esc(data.stated_complaint)}</div></div>`);
    body.appendChild(card);
    const v = h('<div class="card"><h4>Vague phrases: where the real complaint may be hiding</h4><div class="vague"></div></div>');
    data.vague_phrases.forEach((p) => {
      $('.vague', v).appendChild(h(`<span class="ph">"${esc(p.phrase)}"</span>`));
      $('.vague', v).appendChild(h(`<span class="mean">${p.could_mean.map(esc).join(' · ')}</span>`));
    });
    body.appendChild(v);
    body.appendChild(h(`<div class="card"><h4>Questions the investigation must answer</h4><ul class="qlist">${data.open_questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>`));
    highlightStatement(data.vague_phrases.map((p) => p.phrase));
  }

  if (stage === 'investigate') {
    body.appendChild(h(`<div class="card"><h4>Investigation summary</h4><div class="muted">${esc(data.summary)}</div><div class="faint" style="font-size:12px;margin-top:4px">${data.findings} findings · opened ${data.opened.length} documents</div></div>`));
  }

  if (stage === 'diagnose') {
    const top = data.hypotheses[0];
    const stated = $('[data-stage="read"] .card div')?.textContent || '';
    const reveal = h(`
      <div class="reveal">
        <div class="side stated">
          <div class="kicker">What they filed</div>
          <div class="big">${esc(REASONS[state.current.dispute.reason] || state.current.dispute.reason)}</div>
          <div class="needs">${esc(stated)}</div>
        </div>
        <div class="arrow">→</div>
        <div class="side real">
          <div class="kicker">What's really wrong</div>
          <div class="big">${esc(data.real_complaint.summary)}</div>
          <div class="needs"><b>What they actually need:</b> ${esc(data.real_complaint.what_the_client_actually_needs)}</div>
          <div class="conf"><span>Confidence</span><span class="meter"><i style="width:0"></i></span><span class="mono">${data.real_complaint.confidence}%</span></div>
        </div>
      </div>`);
    body.appendChild(reveal);
    requestAnimationFrame(() => ($('.meter i', reveal).style.width = `${data.real_complaint.confidence}%`));

    const hyps = h('<div class="card"><h4>Hypotheses the agent weighed</h4></div>');
    data.hypotheses.forEach((hy) => {
      const row = h(`
        <div class="hyp ${hy === top ? 'top' : ''}">
          <div><div class="h-label">${esc(hy.label)}</div><div class="h-exp">${esc(hy.explanation)}</div></div>
          <div><div class="h-bar"><i style="width:0"></i></div><div class="h-pct">${hy.likelihood}%</div></div>
        </div>`);
      const left = row.firstElementChild;
      if (hy.supporting.length) left.appendChild(chips(hy.supporting));
      if (hy.contradicting.length) left.appendChild(chips(hy.contradicting, 'against'));
      hyps.appendChild(row);
      requestAnimationFrame(() => ($('.h-bar i', row).style.width = `${hy.likelihood}%`));
    });
    body.appendChild(hyps);

    body.appendChild(h(`<div class="card"><h4>Why they filed it as "${esc(REASONS[state.current.dispute.reason] || '')}"</h4><div class="muted">${esc(data.why_this_reason_code)}</div></div>`));

    if (data.freelancer_weaknesses.length) {
      const w = h('<div class="card"><h4>Honest weak points on the freelancer\'s side</h4></div>');
      data.freelancer_weaknesses.forEach((x) => {
        const row = h(`<div style="margin-bottom:8px"><div class="f-why" style="color:var(--text)">${esc(x.issue)}</div></div>`);
        row.appendChild(chips(x.citations, 'against'));
        w.appendChild(row);
      });
      body.appendChild(w);
    }
  }

  if (stage === 'strategy') {
    const card = h(`
      <div class="card">
        <div class="decision"><span class="badge accent">${esc(data.decision.replace(/_/g, ' '))}</span><span class="dlabel">${esc(DECISIONS[data.decision] || '')}</span></div>
        <div class="muted" style="margin-top:8px">${esc(data.rationale)}</div>
        ${data.resolution_action && data.resolution_action !== 'none' ? `<div style="margin-top:8px"><b>Do now:</b> ${esc(data.resolution_action)}</div>` : ''}
        ${Number(data.refund_amount) > 0 ? `<div style="margin-top:4px"><b>Refund:</b> ${fmtMoney(Number(data.refund_amount))}</div>` : ''}
      </div>`);
    body.appendChild(card);
    const plan = h('<div class="card"><h4>Proof plan</h4><table class="plan"><tbody></tbody></table></div>');
    data.proof_plan.forEach((p) => {
      const tr = h(`<tr><td><span class="ans ${p.answers}">${esc(p.answers.replace('_', ' '))}</span></td><td>${esc(p.point)}<div class="cites"></div></td><td><span class="strength ${p.strength}">${p.strength}</span></td></tr>`);
      $('.cites', tr).appendChild(chips(p.evidence));
      $('tbody', plan).appendChild(tr);
    });
    body.appendChild(plan);
  }

  if (stage === 'draft') {
    body.appendChild(h(`<div class="toolrow"><span class="verb">drafted</span><span class="obj">${esc(data.response_title)}</span><span class="hits">${data.claims} claims, checking citations…</span></div>`));
  }

  if (stage === 'verify') {
    body.appendChild(
      h(`<div class="card"><div class="verify-line">
          <span class="verify-big">${data.grounded}/${data.total}</span>
          <span>claims grounded · <b>${data.citations}</b> citations matched word-for-word against their source${data.repaired ? ` · ${data.repaired} repaired` : ''}${data.removed.length ? ` · <span style="color:var(--danger)">${data.removed.length} removed</span>` : ''}</span>
        </div></div>`)
    );
  }

  if (thinking) addThinking(stage, thinking);
}

// Underline the vague phrases inside the client's statement.
function highlightStatement(phrases) {
  const q = $('#statement-quote');
  let html = esc(q.textContent);
  for (const p of phrases) {
    const safe = esc(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(safe, 'i'), (m) => `<mark>${m}</mark>`);
  }
  q.innerHTML = html;
}

// ---------- the final response + submission ----------------------------------------

function renderResult(r) {
  const pkg = r.package;
  const body = stageBody('package');
  state.current.result = r;

  // Footnote numbers, in the same order the server used for the PDF.
  const key = (c) => `${c.doc_id} ${c.anchor}`;
  const notes = pkg.footnotes;

  const letter = h(`<div class="letter"><h3>${esc(r.draft.response_title)}</h3><div class="lmeta">${esc(state.current.freelancer.name)} · ${esc(state.current.dispute.dispute_id)} · every sentence below is backed by a cited source</div></div>`);
  r.draft.claims.forEach((cl) => {
    const p = h(`<p class="ok">${esc(cl.text)} </p>`);
    const seen = new Set();
    cl.citations.forEach((c) => {
      const n = notes.findIndex((f) => key(f) === key(c)) + 1;
      if (seen.has(n)) return;
      seen.add(n);
      const sup = h(`<sup title="${esc(c.doc_id + ' ' + c.anchor)}">[${n}]</sup>`);
      sup.onclick = () => openDrawer(c.doc_id, c.anchor, c.quote);
      p.appendChild(sup);
    });
    letter.appendChild(p);
  });
  (r.removed || []).forEach((cl) => letter.appendChild(h(`<p class="removed" title="Removed: could not be grounded in a source">${esc(cl.text)}</p>`)));
  body.appendChild(letter);

  const files = h(`<div class="toolrow"><span class="verb">files</span>
      <a class="obj" href="/api/cases/${encodeURIComponent(state.current.id)}/files/response-letter.pdf" target="_blank">response-letter.pdf</a>
      <a class="obj" href="/api/cases/${encodeURIComponent(state.current.id)}/files/evidence-appendix.pdf" target="_blank">evidence-appendix.pdf</a>
    </div>`);
  body.appendChild(files);

  body.appendChild(h(`<div class="card"><h4>Message to ${esc(state.current.client.name)}: fixes the real problem</h4><div class="msg">${esc(pkg.clientMessage)}</div></div>`));

  const actions = h(`<div class="card"><h4>PayPal actions</h4></div>`);
  pkg.actions.forEach((a) => {
    actions.appendChild(
      h(`<div class="action" data-kind="${esc(a.kind)}">
          <div><div class="a-label">${esc(a.label)}</div><div class="a-path">${a.path ? `${esc(a.method)} ${esc(a.path)}` : esc(a.note || '')}</div></div>
          <div class="a-state faint" style="font-size:12px">${a.kind === 'email' ? 'copy & send yourself' : 'ready'}</div>
        </div>`)
    );
  });
  const live = state.current.live;
  const submit = h(`<div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn primary">${live ? 'Submit to PayPal sandbox' : 'Submit (simulated: demo dispute)'}</button>
      <span class="faint" style="font-size:12px">${live ? 'Real API calls to the PayPal sandbox.' : 'Demo disputes do not exist inside PayPal, so this shows the exact request that would be sent.'}</span>
    </div>`);
  submit.firstElementChild.onclick = () => doSubmit(submit.firstElementChild, actions);
  actions.appendChild(submit);
  body.appendChild(actions);
  setStage('package', 'done');
  stageEl('package').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function doSubmit(btn, actionsCard) {
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    const res = await api(`/api/cases/${encodeURIComponent(state.current.id)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    for (const r of res.results) {
      const row = $(`.action[data-kind="${CSS.escape(r.kind)}"]`, actionsCard);
      if (!row) continue;
      $('.a-state', row).innerHTML = r.skipped
        ? `<span class="faint">${esc(r.error)}</span>`
        : r.ok
        ? `<span class="result-ok">✓ ${r.simulated ? 'simulated' : `sent${r.debug_id ? ` · debug ${esc(r.debug_id)}` : ''}`}</span>`
        : `<span class="result-bad">✗ ${esc(r.error)}</span>`;
      if (r.request) row.appendChild(h(`<pre class="req">${esc(JSON.stringify(r.request, null, 2))}${r.response ? `\n\n// PayPal response\n${esc(JSON.stringify(r.response, null, 2))}` : ''}${r.paypal ? `\n\n// PayPal error\n${esc(JSON.stringify(r.paypal, null, 2))}` : ''}</pre>`));
    }
    btn.textContent = res.live ? 'Submitted to PayPal' : 'Simulated';
    toast(res.live ? 'Response submitted to the PayPal sandbox.' : 'Simulated: request shown for each action.');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Retry submit';
    toast(err.message);
  }
}

// ---------- evidence drawer ----------------------------------------------------------

async function openDrawer(docId, anchor, quote) {
  const doc = await api(`/api/cases/${encodeURIComponent(state.current.id)}/documents/${encodeURIComponent(docId)}`).catch(() => null);
  if (!doc) return;
  $('#drawer-kicker').textContent = `${doc.doc_id} · ${doc.source}`;
  $('#drawer-title').textContent = doc.title;
  const body = $('#drawer-body');
  body.innerHTML = '';
  let target = null;
  for (const s of doc.sections) {
    let text = esc(s.text);
    if (s.anchor === anchor && quote) {
      for (const piece of quote.split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length > 3)) {
        const safe = esc(piece.replace(/^["']|["']$/g, '')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(safe, 'i'), (m) => `<mark>${m}</mark>`);
      }
    }
    const el = h(`<div class="sec ${s.anchor === anchor ? 'hl' : ''}"><div class="sa">${esc(s.anchor)}</div><div class="sh">${esc(s.heading)}</div><div class="st">${text}</div></div>`);
    if (s.anchor === anchor) target = el;
    body.appendChild(el);
  }
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
}
