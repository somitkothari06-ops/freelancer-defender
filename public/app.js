// Freelancer Defender dashboard.
// Plain JavaScript, no build step. Two views:
// (The landing page is public/index.html; this is the app at /app.)
//   #/disputes    all disputes: deadline timeline (Bryntum) + dispute list (AG Grid)
//   #/case/<id>   one dispute: live countdown, the three-card summary, the agent's live
//                 reasoning, the evidence, and the response to send through PayPal
'use strict';

// ---------- helpers -------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const fmtMoney = (n, cur = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${n} ${cur}`; // unknown currency code
  }
};
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
};
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s || '');

const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Incorrect amount',
  OTHER: 'Other',
};
// The agent's decision, in the words a freelancer would use.
const DECISIONS = {
  CONTEST: { short: 'Fight it', long: 'Fight the reversal with your evidence.' },
  CONTEST_AND_RESOLVE: { short: 'Fight + fix', long: 'Fight the reversal, and fix what is really bothering your client.' },
  PARTIAL_REFUND_AND_CONTEST: { short: 'Refund part', long: 'Refund the part you genuinely owe, and fight for the rest.' },
  ACCEPT_AND_REFUND: { short: 'Refund', long: 'Your client has a point here. Refund and move on.' },
};

// Friendly names for documents, so citations read "Contract · §7.2" not "CONTRACT · §7.2".
const DOC_NAMES = { DISPUTE: 'PayPal dispute', 'PAYPAL-TXN': 'PayPal payments', 'PAYPAL-INVOICE': 'PayPal invoice', MSA: 'Contract', GITHUB: 'GitHub log' };
const docName = (id) => DOC_NAMES[id] || id.toLowerCase().replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
// Contract anchors use the legal "§" sign; show "Section 6.1" instead.
const anchorName = (a) => String(a).replace(/^§\s*/, 'Section ');
// "Contract · Section 6.1", but just "Emails" (codes like E6 or L5 mean nothing to a reader).
const sourceName = (c) => (/^§/.test(c.anchor) ? `${docName(c.doc_id)} · ${anchorName(c.anchor)}` : docName(c.doc_id));

function timeLeft(due) {
  // No due date means PayPal isn't waiting on the freelancer right now (e.g. under review).
  if (!due) return { ms: Infinity, hrs: Infinity, days: 0, h: 0, m: 0, s: 0, short: 'No deadline' };
  const ms = Math.max(0, new Date(due) - Date.now());
  const hrs = Math.floor(ms / 3.6e6);
  const days = Math.floor(hrs / 24);
  const t = { ms, hrs, days, h: hrs % 24, m: Math.floor((ms % 3.6e6) / 6e4), s: Math.floor((ms % 6e4) / 1000) };
  t.short = ms === 0 ? 'Expired' : days ? `${days}d ${t.h}h` : `${hrs}h ${t.m}m`;
  return t;
}
const pad = (n) => String(n).padStart(2, '0');
// PayPal reason codes sometimes appear in the AI's wording; show the plain label instead.
const plainCodes = (s) => String(s ?? '').replace(/\b[A-Z][A-Z_]{8,}\b/g, (code) => (REASONS[code] ? `"${REASONS[code]}"` : code));
const say = (s) => esc(plainCodes(s));
// Cut at a sentence end when there is one in reach, so cards don't stop mid-sentence.
const clipSentence = (s, n) => {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > n * 0.5 ? cut.slice(0, end + 1) : clip(s, n);
};
// The agent writes refund amounts freely ("$250", "1,250.00"); read the number.
const refundOf = (strategy) => Math.max(0, parseFloat(String(strategy.refund_amount ?? '').replace(/[^0-9.]/g, '')) || 0);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

// PayPal's monogram, for "Log in with PayPal".
const PAYPAL_LOGO = '<svg class="pp-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#003087" d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106z"/><path fill="#009cde" d="M21.222 6.917a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z"/></svg>';

const SOURCE_TAGS = { live: ['PayPal live', 'green'], yours: ['Yours', 'blue'], seeded: ['Demo', ''] };

// ---------- "Try your own case" -------------------------------------------------------
// Cases typed in here are unlisted on the server; this browser remembers their ids.
const MY_CASES = 'fd-my-cases';
function myCases() {
  try {
    return JSON.parse(localStorage.getItem(MY_CASES) || '[]');
  } catch {
    return [];
  }
}
function rememberCase(id) {
  try {
    localStorage.setItem(MY_CASES, JSON.stringify([id, ...myCases().filter((x) => x !== id)].slice(0, 20)));
  } catch { /* the case still works for this visit */ }
}

// An example to try in two clicks: a video editor's client disputes after asking for extra work.
const EXAMPLE_CASE = {
  client: 'Northpeak Fitness',
  work: 'Launch promo video (60 seconds)',
  amount: '900',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  statement: 'The video we received is not what we ordered and we could not use it for our launch campaign.',
  freelancer: 'Sam Rivera',
  evidence: [
    { kind: 'contract', title: 'Video production agreement', text: '1. Parties\nThis agreement is between Sam Rivera ("Editor") and Northpeak Fitness ("Client").\n\n2. Deliverables\nOne 60-second promotional video, delivered in 16:9 (YouTube) and 9:16 (Reels) formats.\n\n3. Revisions\nTwo rounds of revisions are included. Further changes or new cuts are quoted separately.\n\n4. Acceptance\nClient approval by email counts as acceptance of the final video.\n\n5. Payment\n$900, paid in full on acceptance.' },
    { kind: 'messages', title: 'Emails with Northpeak', text: 'Sep 2, Sam: Here is version 2 with your revision notes, in both formats.\n\nSep 3, Dana (Northpeak): Perfect, approved! Paying the invoice now.\n\nSep 9, Dana: Our ads agency says we also need a 15-second version for Instagram Stories. Can you send that over this week? Launch is on the 15th.\n\nSep 9, Sam: Happy to! A 15-second cut is a new deliverable, so it would be $250 extra. I can have it by Friday if you want it.\n\nSep 12, Sam: Just checking in on the 15-second version, do you want me to go ahead?' },
  ],
};

function openNewCase() {
  $('#drawer-kicker').textContent = 'Try your own case';
  $('#drawer-title').textContent = 'What happened?';
  const body = $('#drawer-body');
  body.innerHTML = `
    <form class="ev-form" id="nc-form">
      <button type="button" class="linkbtn" id="nc-example" style="align-self:flex-start">Fill in an example</button>
      <label>Your client
        <input name="client" required maxlength="80" placeholder="e.g. Northpeak Fitness" />
      </label>
      <label>What was the work?
        <input name="work" maxlength="120" placeholder="e.g. Launch promo video" />
      </label>
      <label>Amount they're disputing (USD)
        <input name="amount" required inputmode="decimal" placeholder="e.g. 900" />
      </label>
      <label>What did they tell their bank?
        <select name="reason">
          <option value="MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED">Not as described</option>
          <option value="MERCHANDISE_OR_SERVICE_NOT_RECEIVED">They never received it</option>
          <option value="UNAUTHORISED">They didn't authorize the payment</option>
          <option value="OTHER">Something else</option>
        </select>
      </label>
      <label>Their words
        <textarea name="statement" rows="4" required maxlength="2000" placeholder="Paste what the client wrote in the dispute."></textarea>
      </label>
      <label>Your name (optional)
        <input name="freelancer" maxlength="80" placeholder="e.g. Sam Rivera" />
      </label>
      <p class="faint" style="font-size:13px;margin:0">Next, add your contract and emails, then let the agent investigate. Your case is private to this browser and isn't sent to PayPal.</p>
      <div style="display:flex;gap:8px"><button class="btn primary" type="submit">Create my case</button><button class="btn" type="button" id="nc-cancel">Cancel</button></div>
    </form>`;
  const form = $('#nc-form');
  let example = false;
  $('#nc-cancel').onclick = closeDrawer;
  $('#nc-example').onclick = () => {
    example = true;
    for (const k of ['client', 'work', 'amount', 'reason', 'statement', 'freelancer']) form[k].value = EXAMPLE_CASE[k];
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const data = Object.fromEntries(['client', 'work', 'amount', 'reason', 'statement', 'freelancer'].map((k) => [k, form[k].value]));
      const { id } = await api('/api/custom-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      rememberCase(id);
      // The example comes with its paperwork, so it can be run straight away.
      if (example) {
        for (const ev of EXAMPLE_CASE.evidence) {
          await api(`/api/cases/${encodeURIComponent(id)}/evidence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
        }
      }
      closeDrawer();
      location.hash = `#/case/${encodeURIComponent(id)}`;
      toast(example ? 'Example case created with its contract and emails. Press "Find out what\'s really going on".' : 'Case created. Add your contract and emails, then run the agent.');
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  };
  showDrawer();
  setTimeout(() => form.client.focus(), 200);
}

// ---------- app state -------------------------------------------------------------

const state = {
  status: null,
  queue: null,
  grid: null,
  scheduler: null,
  current: null, // the dispute being viewed
  stream: null, // active EventSource
  clockTimer: null,
  judgeMode: false, // arrived via /app#/judge: one-shot, consumed by the next openCase()
  keepStagesOpen: false, // true only while showing the judge-mode case's own run
  judgeAutoplayTimer: null,
};

// A link anyone can send a judge: opens the hero case and plays its recorded run with no
// clicking required, and keeps the reasoning (not just the one-line summary) on screen.
const JUDGE_CASE_ID = 'PP-D-27140-HALDEN';

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
  if (location.hash === '#/judge') {
    state.judgeMode = true;
    location.hash = `#/case/${JUDGE_CASE_ID}`; // re-enters route() via hashchange, flag already set
    return;
  }
  const m = location.hash.match(/^#\/case\/(.+)$/);
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  clearInterval(state.clockTimer);
  clearTimeout(state.judgeAutoplayTimer);
  const page = m ? 'case' : 'queue';
  if (page !== 'queue' && state.scheduler) {
    state.scheduler.destroy();
    state.scheduler = null;
    $('#now-marker')?.remove();
  }
  for (const v of ['queue', 'case']) $(`#view-${v}`).classList.toggle('hidden', v !== page);
  $('#nav-disputes').classList.add('active');
  if (page === 'case') openCase(decodeURIComponent(m[1]));
  else openQueue();
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  $('#status').innerHTML = `
    <span class="pill ${s.paypal.enabled ? 'on' : ''}">${s.paypal.enabled ? `PayPal ${esc(s.paypal.env)} connected` : 'PayPal not connected'}</span>
    ${s.user
      ? `<span class="who-signed" title="${esc(s.user.email)}"><span class="avatar">${esc(initials(s.user.name))}</span><span class="who-name">${esc(s.user.name)}</span></span><button class="linkbtn" id="logout">Sign out</button>`
      : `<a class="btn small pp-btn" href="/auth/paypal">${PAYPAL_LOGO}Log in with PayPal</a>`}`;
  const out = $('#logout');
  if (out) {
    out.onclick = async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      state.status.user = null;
      renderStatus();
      toast('Signed out.');
    };
  }
}

// ================================================================================
// All disputes
// ================================================================================

async function openQueue() {
  document.title = 'Freelancer Defender';

  const data = await api(`/api/cases?mine=${encodeURIComponent(myCases().join(','))}`);
  $('#new-case').onclick = openNewCase;
  state.queue = data;
  const rows = data.cases;

  const open = rows.filter((r) => r.status !== 'RESOLVED');
  const atRisk = open.reduce((n, r) => n + r.amount, 0);
  const next = rows.filter((r) => r.due).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
  const ready = rows.filter((r) => r.has_replay).length;
  $('#queue-stats').innerHTML = `
    <div class="stat navy"><span class="label">Earned money at risk</span><span class="value">${fmtMoney(atRisk)}</span><span class="sub">across ${open.length} open dispute${open.length === 1 ? '' : 's'}</span></div>
    <div class="stat red"><span class="label">Next deadline</span><span class="value">${next ? esc(timeLeft(next.due).short) : '—'}</span><span class="sub">${next ? esc(next.client.split(',').pop().trim()) : 'Nothing due'}</span></div>
    <div class="stat"><span class="label">Responses ready</span><span class="value">${ready} of ${rows.length}</span><span class="sub">worked out by the agent, waiting for you</span></div>`;

  const pp = data.paypal;
  $('#paypal-banner').innerHTML = pp.error
    ? `<div class="banner warn"><b>PayPal sandbox error:</b> ${esc(pp.error)}</div>`
    : pp.enabled
      ? ''
      : '<div class="banner"><b>Demo mode.</b> PayPal isn\'t connected, so you\'re seeing demo disputes and sending is simulated.</div>';

  renderTimeline(rows);
  renderGrid(rows);
  setupStudioToggle(rows);
}

// "Ask about your disputes" (AG Studio): a natural-language panel over the same
// rows shown in the grid above. Created lazily on first open, once per page
// lifetime - Studio's init cost and trial-license watermark aren't worth paying
// unless someone actually opens it, and re-navigating to the queue shouldn't
// recreate (and lose) an already-open conversation.
//
// "Watch an example" plays a scripted, guaranteed-reliable conversation (see
// studio-demo.js) instead of asking the live model, then falls through to the same
// live adapter for any follow-up question typed afterward - so there's no live-demo
// risk for the first interaction, and nothing lost for later ones.
let studioCreated = false;
let studioPanel = null;
function setupStudioToggle(rows) {
  const toggleBtn = $('#studio-toggle');
  const demoBtn = $('#studio-demo');
  const panel = $('#studio-panel');

  function ensureOpen() {
    panel.classList.remove('hidden');
    toggleBtn.textContent = 'Hide';
  }

  function ensureCreated(adapter) {
    if (studioCreated) return true;
    studioCreated = true;
    const createFn = window.agStudio?.createStudioWithAi;
    if (!createFn || !window.freelancerDefenderStudio) {
      panel.innerHTML = '<p class="faint">AG Studio did not load — check your connection and reload.</p>';
      return false;
    }
    createFn(panel, { data: { sources: [{ id: 'disputes', data: rows }] }, mode: 'edit', ai: ({ api }) => window.agStudio.createAiHarness(api, { adapter }) });
    studioPanel = panel;
    return true;
  }

  toggleBtn.onclick = () => {
    const opening = panel.classList.toggle('hidden') === false;
    toggleBtn.textContent = opening ? 'Hide' : 'Ask a question →';
    if (opening) ensureCreated(window.freelancerDefenderStudio.groqAdapter());
  };

  demoBtn.onclick = () => {
    ensureOpen();
    // If Studio already existed (e.g. the user asked their own question first), there's no
    // way to retroactively hand it a scripted adapter - just ask the demo question live.
    ensureCreated(buildDemoAdapter());
    if (studioPanel) askStudio(studioPanel, window.freelancerDefenderStudioDemo.question);
  };
}

function buildDemoAdapter() {
  const studio = window.freelancerDefenderStudio;
  const demo = window.freelancerDefenderStudioDemo;
  if (!studio || !demo) return studio?.groqAdapter();
  return studio.replayAdapter(demo.buildScript(studio), () => studio.groqAdapter());
}

// Types the given question into Studio's own chat input and submits it, the same way a
// person would - Studio owns that UI, this just drives it, same as a user's keystrokes would.
// On first creation Studio renders asynchronously, so the input isn't there yet; poll briefly.
function askStudio(panel, question, attemptsLeft = 20) {
  const textarea = panel.querySelector('textarea');
  if (!textarea) {
    if (attemptsLeft > 0) setTimeout(() => askStudio(panel, question, attemptsLeft - 1), 250);
    return;
  }
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setValue.call(textarea, question);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}

// Deadline timeline (Bryntum Scheduler): one row per dispute, a bar from when it was
// filed to when your response is due. Falls back to nothing if the library didn't load.
function renderTimeline(rows) {
  const el = $('#timeline');
  const Scheduler = window.bryntum?.scheduler?.Scheduler;
  if (!Scheduler) {
    el.outerHTML = '<div id="timeline" class="tl-fallback">Timeline unavailable (the scheduler library did not load).</div>';
    return;
  }
  const withDue = rows.filter((r) => r.due).sort((a, b) => new Date(a.due) - new Date(b.due));
  // The view starts at midnight today and ends just after the last deadline, scaled to fit the
  // card. Each bar runs from when the dispute arrived (clipped to the view) to its deadline, so
  // bars start flush at the left edge; the black "Now" marker shows the current time.
  const now = Date.now();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const resources = withDue.map((r) => ({ id: r.dispute_id, name: r.client.split(',').pop().trim(), amount: fmtMoney(r.amount) }));
  const events = withDue.map((r) => {
    const t = timeLeft(r.due);
    return {
      id: r.dispute_id,
      resourceId: r.dispute_id,
      startDate: new Date(Math.max(+new Date(r.created), +start)),
      endDate: new Date(r.due),
      // Short label under a day so it fits inside the (short) bar.
      name: `${t.days ? t.short : `${t.hrs}h`} left`,
      // Calm navy tints; urgency is a red dot and red text only (styles.css, .tl-*).
      cls: [r.has_replay ? 'tl-ready' : 'tl-todo', t.hrs < 48 ? 'tl-urgent' : ''].join(' ').trim(),
    };
  });
  const end = new Date(Math.max(Date.now() + 4 * 864e5, ...events.map((e) => +e.endDate)) + 864e5);
  if (state.scheduler) state.scheduler.destroy();
  el.innerHTML = '';
  state.scheduler = new Scheduler({
    appendTo: el,
    startDate: start,
    endDate: end,
    viewPreset: 'dayAndWeek',
    forceFit: true,
    rowHeight: 52,
    barMargin: 8,
    readOnly: true,
    eventStyle: 'plain',
    features: { timeRanges: false, eventTooltip: false, scheduleTooltip: false, cellMenu: false, eventMenu: false, scheduleMenu: false },
    columns: [
      { text: 'Client', field: 'name', width: 170 },
      { text: 'Amount', field: 'amount', width: 100 },
    ],
    resources,
    events,
    listeners: { eventClick: ({ eventRecord }) => (location.hash = `#/case/${encodeURIComponent(eventRecord.id)}`) },
  });
  placeNowMarker();
}

// "Now" marker under the timeline, pointing up at the current time.
function placeNowMarker() {
  const sch = state.scheduler;
  const box = $('#timeline');
  if (!sch || !box) return;
  let m = $('#now-marker');
  if (!m) {
    m = h('<div id="now-marker" class="now-marker" aria-hidden="true"></div>');
    box.after(m);
  }
  const axis = sch.timeAxisSubGrid?.element;
  const x = sch.getCoordinateFromDate(new Date());
  if (!axis || x == null || x < 0) return m.classList.add('hidden');
  const left = axis.getBoundingClientRect().left - box.parentElement.getBoundingClientRect().left + x;
  m.classList.remove('hidden');
  m.style.left = `${left}px`;
  m.textContent = `▲ Now · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
window.addEventListener('resize', () => requestAnimationFrame(placeNowMarker));
setInterval(placeNowMarker, 60000);

// The dispute list (AG Grid).
function renderGrid(rows) {
  const columnDefs = [
    {
      headerName: 'Time left',
      field: 'due',
      width: 145,
      sort: 'asc',
      // Disputes with no deadline sort last (and compare equal to each other).
      comparator: (a, b) => (a ? +new Date(a) : Number.MAX_SAFE_INTEGER) - (b ? +new Date(b) : Number.MAX_SAFE_INTEGER),
      cellRenderer: (p) => {
        if (p.node.rowPinned) return '';
        const t = timeLeft(p.value);
        return `<span class="tleft ${t.hrs < 48 ? 'urgent' : ''}">${esc(t.short)}</span>`;
      },
    },
    {
      headerName: 'Client',
      field: 'client',
      getQuickFilterText: (p) => `${p.value} ${p.data.freelancer} ${p.data.title}`,
      flex: 1.2,
      minWidth: 190,
      cellRenderer: (p) =>
        p.node.rowPinned
          ? `<span class="main"><b>${esc(p.value)}</b></span>`
          : `<div class="cell-stack"><span class="main">${esc(p.value.split(',').pop().trim())}</span><span class="sub">${esc(p.data.freelancer)} · ${esc(p.data.title)}</span></div>`,
    },
    {
      headerName: 'What they filed',
      field: 'reason',
      width: 165,
      valueFormatter: (p) => REASONS[p.value] || p.value,
      getQuickFilterText: (p) => REASONS[p.value] || p.value,
      cellRenderer: (p) => (p.node.rowPinned ? '' : `<span class="tag">${esc(REASONS[p.value] || p.value)}</span>`),
    },
    {
      headerName: "What's actually going on",
      field: 'real_summary',
      flex: 1.6,
      minWidth: 220,
      wrapText: true,
      autoHeight: true,
      cellStyle: { lineHeight: '1.4', paddingTop: '10px', paddingBottom: '10px' },
      cellRenderer: (p) =>
        p.node.rowPinned ? `<span class="faint">${esc(p.value)}</span>` : p.value ? `<span style="font-size:14px">${esc(clip(p.value, 120))}</span>` : '<span class="faint">Not analyzed yet</span>',
    },
    {
      headerName: 'Amount',
      field: 'amount',
      width: 110,
      type: 'rightAligned',
      cellRenderer: (p) => `<span class="amt">${fmtMoney(p.value, p.data.currency)}</span>`,
      cellStyle: { justifyContent: 'flex-end' },
    },
    {
      headerName: 'Plan',
      field: 'decision',
      width: 120,
      valueFormatter: (p) => DECISIONS[p.value]?.short || 'Analyze',
      getQuickFilterText: (p) => DECISIONS[p.value]?.short || 'Analyze',
      cellRenderer: (p) => {
        if (p.node.rowPinned) return '';
        const d = DECISIONS[p.value];
        if (!d) return '<span class="tag">Analyze</span>';
        const cls = p.value === 'PARTIAL_REFUND_AND_CONTEST' || p.value === 'ACCEPT_AND_REFUND' ? 'amber' : 'blue';
        return `<span class="tag ${cls}">${esc(d.short)}</span>`;
      },
    },
    {
      headerName: 'Source',
      field: 'source',
      width: 125,
      getQuickFilterText: (p) => SOURCE_TAGS[p.value]?.[0] || 'Demo',
      cellRenderer: (p) => (p.node.rowPinned ? '' : `<span class="tag ${SOURCE_TAGS[p.value]?.[1] || ''}">${SOURCE_TAGS[p.value]?.[0] || 'Demo'}</span>`),
    },
  ];

  // A total row pinned under the table: what's at stake across every dispute shown.
  const total = (shown) => [{
    client: `Total · ${shown.length} dispute${shown.length === 1 ? '' : 's'}`,
    amount: shown.reduce((a, r) => a + r.amount, 0),
    currency: shown[0]?.currency || 'USD',
    real_summary: `${shown.filter((r) => r.real_summary).length} worked out, ${shown.filter((r) => !r.real_summary).length} still to do`,
  }];
  const shownRows = () => {
    const out = [];
    state.grid?.forEachNodeAfterFilter((n) => out.push(n.data));
    return out;
  };

  if (state.grid) {
    state.grid.setGridOption('rowData', rows);
    // Row heights measured while the list was hidden are wrong; measure again now it's visible.
    requestAnimationFrame(() => state.grid.resetRowHeights());
    state.grid.setGridOption('pinnedBottomRowData', total(shownRows()));
    return;
  }
  state.grid = agGrid.createGrid($('#grid'), {
    columnDefs,
    rowData: rows,
    defaultColDef: { sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true },
    rowHeight: 64,
    domLayout: 'autoHeight',
    animateRows: true,
    pinnedBottomRowData: total(rows),
    // The total follows the search box and column filters.
    onFilterChanged: () => state.grid.setGridOption('pinnedBottomRowData', total(shownRows())),
    onRowClicked: (e) => !e.node.rowPinned && (location.hash = `#/case/${encodeURIComponent(e.data.dispute_id)}`),
    onCellKeyDown: (e) => e.event.key === 'Enter' && !e.node.rowPinned && (location.hash = `#/case/${encodeURIComponent(e.data.dispute_id)}`),
    overlayNoRowsTemplate: '<span class="muted">No open disputes. Every payment you earned is safe.</span>',
  });
  setInterval(() => state.grid?.refreshCells({ columns: ['due'], force: true }), 30000);
  $('#grid-search').oninput = (e) => state.grid.setGridOption('quickFilterText', e.target.value);
}

// ================================================================================
// One dispute
// ================================================================================

async function openCase(id) {
  $('#result').classList.add('hidden');
  $('#result').innerHTML = '';
  window.scrollTo(0, 0);
  ['#trail', '#mode-banner', '#controls', '#three', '#case-head', '#clock', '#locker'].forEach((s) => ($(s).innerHTML = ''));

  let c;
  try {
    c = await api(`/api/cases/${encodeURIComponent(id)}`);
  } catch (err) {
    $('#locker-count').textContent = '';
    $('#case-head').innerHTML = err.status === 404 || /\b404\b/.test(err.message) || err.status === 400
      ? `<h1 style="margin:0 0 8px">We couldn't find that dispute</h1><p class="muted">It may have been closed, or the link is wrong.</p><a class="btn" style="align-self:flex-start" href="#/disputes">← All disputes</a>`
      : `<div class="banner warn">${esc(err.message)}</div>`;
    return;
  }
  state.current = { id, ...c };
  document.title = `${c.client.company} · Freelancer Defender`;

  renderHero(c);
  renderClock(c);
  renderThree(c);
  renderLocker(c);
  renderControls(c);
  renderTrailSkeleton();

  // Judge mode is one-shot: it only auto-plays the single case it was meant to show,
  // never a later case the person (or a stray timer) happens to open afterward.
  const judgeAutoplay = state.judgeMode && id === JUDGE_CASE_ID;
  state.judgeMode = false;
  state.keepStagesOpen = judgeAutoplay;
  if (judgeAutoplay) {
    try { localStorage.setItem('fd-tour-done', '1'); } catch { /* ignore */ }
    toast('Judge mode: playing a recorded run of the agent on a real dispute.');
    clearTimeout(state.judgeAutoplayTimer);
    state.judgeAutoplayTimer = setTimeout(() => {
      if (state.current?.id === id && !state.stream) startRun('replay');
    }, 500);
  } else {
    maybeTour();
  }
}

// ---------- first-visit tour -------------------------------------------------------
// Four short tips the first time someone opens a dispute. Remembered per browser.
const TOUR = [
  ['#clock', 'Your deadline', 'It counts down live. This is how long you have to answer.'],
  ['#three > div:first-child', 'What they told the bank', "The client's complaint, straight from PayPal."],
  ['#controls', 'Let the agent work', 'It reads your contract, emails and logs. The recording plays in about a minute.'],
  ['#card-real', "What's actually going on", 'The real problem shows up here, with proof from your own records.'],
];
function maybeTour() {
  try {
    if (localStorage.getItem('fd-tour-done')) return;
  } catch {
    return; // no storage (private mode): skip the tour rather than show it every time
  }
  setTimeout(() => runTour(0), 600);
}
function endTour() {
  try { localStorage.setItem('fd-tour-done', '1'); } catch { /* ignore */ }
  $('#tour')?.remove();
  window.removeEventListener('resize', state.tourPlace);
}
function runTour(i) {
  const [sel, title, text] = TOUR[i];
  const target = $(sel);
  if (!target) return endTour();
  let box = $('#tour');
  if (!box) {
    box = h('<div id="tour" role="dialog" aria-live="polite"><div class="tour-spot"></div><div class="tour-tip"></div></div>');
    document.body.appendChild(box);
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const tip = $('.tour-tip', box);
  tip.innerHTML = `<span class="kicker">${i + 1} of ${TOUR.length}</span><h4>${esc(title)}</h4><p>${esc(text)}</p>
    <div class="tour-btns"><button class="linkbtn" id="tour-skip">Skip</button><button class="btn primary" id="tour-next">${i === TOUR.length - 1 ? 'Got it' : 'Next'}</button></div>`;
  $('#tour-skip').onclick = endTour;
  $('#tour-next').onclick = () => (i === TOUR.length - 1 ? endTour() : runTour(i + 1));
  $('#tour-next').focus({ preventScroll: true });
  const place = () => {
    const r = target.getBoundingClientRect();
    const spot = $('.tour-spot', box);
    Object.assign(spot.style, { top: `${r.top - 8}px`, left: `${r.left - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
    const below = r.bottom + 220 < innerHeight;
    tip.style.top = `${below ? r.bottom + 18 : Math.max(16, r.top - tip.offsetHeight - 18)}px`;
    tip.style.left = `${Math.min(Math.max(16, r.left), innerWidth - tip.offsetWidth - 16)}px`;
  };
  window.removeEventListener('resize', state.tourPlace);
  state.tourPlace = place;
  window.addEventListener('resize', place);
  setTimeout(place, 350); // after the smooth scroll settles
  place();
}

function renderHero(c) {
  const d = c.dispute;
  const first = c.freelancer.name.split(' ')[0];
  $('#case-head').innerHTML = `
    <div class="tags">
      <span class="tag red">${d.dispute_channel === 'EXTERNAL' ? 'Bank chargeback' : 'PayPal dispute'}</span>
      <span class="tag">${esc(c.client.company)}</span>
      ${c.live ? '<span class="tag green">Live from PayPal sandbox</span>' : c.yours ? '<span class="tag blue">Your case</span>' : '<span class="tag">Demo dispute</span>'}
    </div>
    <h1 class="amount num">${fmtMoney(Number(d.dispute_amount?.value || 0), d.dispute_amount?.currency_code)}</h1>
    <p class="lede">${c.fresh || c.yours ? 'Add your contract, emails and delivery records, and we\'ll' : `${esc(first)}, let's protect what you earned. We'll`} go through your evidence and build your response with you, step by step.</p>
    <span class="who">${esc(c.freelancer.business)} · ${esc(c.title)}</span>`;
}

// The live countdown and the "who gets how long" comparison.
function renderClock(c) {
  const d = c.dispute;
  const tl = state.status?.timelines || { bankDecisionDays: 75, cardholderFilingDays: 180, sources: [] };
  const sources = `<div class="src">Sources: ${(tl.sources || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(' · ')}</div>`;
  if (d.status === 'RESOLVED') {
    const outcome = d.dispute_outcome?.outcome_code;
    const won = outcome === 'RESOLVED_SELLER_FAVOUR' || outcome === 'RESOLVED_SELLER_FAVOR';
    const lost = outcome === 'RESOLVED_BUYER_FAVOUR' || outcome === 'RESOLVED_BUYER_FAVOR';
    $('#clock').innerHTML = `
      <span class="label">This dispute</span>
      <div style="font-size:30px;font-weight:800">${won ? 'Closed: you kept the money' : lost ? 'Closed in the client\'s favour' : 'PayPal closed this dispute'}</div>
      <div style="color:#bfdbfe;font-size:14px">Nothing is due. You can still look through the evidence and the agent's reasoning.</div>
      ${sources}`;
    return;
  }
  if (!d.seller_response_due_date) {
    $('#clock').innerHTML = `
      <span class="label">Time left to respond</span>
      <div style="font-size:30px;font-weight:800">No deadline right now</div>
      <div style="color:#bfdbfe;font-size:14px">PayPal is reviewing this dispute (${esc(String(d.status || 'in review').toLowerCase().replace(/_/g, ' '))}). We'll show the clock as soon as they need something from you.</div>
      ${sources}`;
    return;
  }
  const windowDays = Math.round((new Date(d.seller_response_due_date) - new Date(d.create_time)) / 864e5);
  $('#clock').innerHTML = `
    <span class="label">Time left to respond</span>
    <div class="boxes">
      <div class="box"><b id="c-d">0</b><span>days</span></div>
      <div class="box"><b id="c-h">00</b><span>hours</span></div>
      <div class="box"><b id="c-m">00</b><span>min</span></div>
      <div class="box"><b id="c-s">00</b><span>sec</span></div>
    </div>
    <div class="lines">
      <div class="line"><div class="row"><span>Your client could dispute for</span><b>${tl.cardholderFilingDays} days</b></div><div class="bar"><i style="width:100%"></i></div></div>
      <div class="line"><div class="row"><span>Their bank can take up to</span><b>${tl.bankDecisionDays} days</b></div><div class="bar"><i style="width:${(tl.bankDecisionDays / tl.cardholderFilingDays) * 100}%"></i></div></div>
      <div class="line you"><div class="row"><span>You have left</span><b id="c-left"></b></div><div class="bar"><i id="c-bar"></i></div></div>
    </div>
    ${sources}`;
  const tick = () => {
    const t = timeLeft(d.seller_response_due_date);
    if (!$('#c-d')) return;
    $('#c-d').textContent = t.days;
    $('#c-h').textContent = pad(t.h);
    $('#c-m').textContent = pad(t.m);
    $('#c-s').textContent = pad(t.s);
    $('#c-left').textContent = `${t.days}d ${t.h}h of ${windowDays} days`;
    $('#c-bar').style.width = `${(t.ms / (tl.cardholderFilingDays * 864e5)) * 100}%`;
  };
  tick();
  state.clockTimer = setInterval(tick, 1000);
}

// What the client wrote, from the PayPal dispute.
function clientStatement(d) {
  const notes = (d.disputed_transactions || []).flatMap((t) => (t.items || []).map((i) => i.notes).filter(Boolean));
  const msgs = (d.messages || []).filter((m) => m.posted_by === 'BUYER').map((m) => m.content);
  return [...new Set([...notes, ...msgs])].join(' ').replace(/^Cardholder statement forwarded by issuing bank[^:]*:\s*/, '');
}

function renderThree(c) {
  const stmt = clientStatement(c.dispute);
  $('#three').innerHTML = `
    <div>
      <span class="kicker">1 · What the client told their bank</span>
      <p class="big" id="said">"${esc(clipSentence(stmt, 120))}"</p>
      <span class="note">Filed as "${esc(REASONS[c.dispute.reason] || c.dispute.reason)}"</span>
    </div>
    <div class="waiting" id="card-real">
      <span class="kicker">2 · What's actually going on</span>
      <p class="big">We haven't looked yet. Run the agent and it will read your evidence to find out.</p>
    </div>
    <div class="waiting" id="card-plan">
      <span class="kicker">3 · What we'll do about it</span>
      <p class="big">A plan appears here once we know what's really wrong.</p>
    </div>`;
}

function renderLocker(c) {
  $('#locker-count').textContent = `${c.documents.length} documents`;
  const box = $('#locker');
  box.innerHTML = '';
  const own = c.documents.filter((d) => d.kind !== 'paypal_record');
  if (!own.length) {
    box.appendChild(h('<div class="nudge">PayPal only has its side. Add your contract, emails and delivery records so the agent can prove the work was agreed and delivered.</div>'));
  }
  for (const d of c.documents) {
    const b = h(`
      <div class="doc" role="button" tabindex="0" data-doc="${esc(d.doc_id)}" title="${esc(d.summary)}">
        <span class="ld"></span>
        <span style="flex:1"><div class="lt">${esc(d.title)}</div><div class="ls">${d.kind === 'paypal_record' ? '<span class="src-paypal">From PayPal</span> · ' : ''}${d.added ? '<span class="src-you">Added by you</span> · ' : ''}${esc(d.source)}</div></span>
        ${d.added ? '<button class="icon-btn sm" title="Remove this document" aria-label="Remove">✕</button>' : ''}
      </div>`);
    b.onclick = () => openDrawer(d.doc_id);
    b.onkeydown = (e) => e.key === 'Enter' && openDrawer(d.doc_id);
    const rm = $('.icon-btn', b);
    if (rm) {
      rm.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove "${d.title}" from your evidence?`)) return;
        try {
          await api(`/api/cases/${encodeURIComponent(c.id || state.current.id)}/evidence/${encodeURIComponent(d.doc_id)}`, { method: 'DELETE' });
          reloadEvidence();
        } catch (err) {
          toast(err.message);
        }
      };
    }
    box.appendChild(b);
  }
  const add = h('<button class="btn add-ev">+ Add evidence</button>');
  add.onclick = openAddEvidence;
  box.appendChild(add);
}

async function reloadEvidence() {
  const c = await api(`/api/cases/${encodeURIComponent(state.current.id)}`);
  Object.assign(state.current, { documents: c.documents });
  renderLocker(state.current);
}

// The freelancer's own document: paste text or pick a text file.
function openAddEvidence() {
  const kinds = state.current.evidence_kinds || { contract: 'Contract or agreement', messages: 'Emails or messages', log: 'Delivery or activity log', other: 'Other document' };
  $('#drawer-kicker').textContent = 'Your evidence';
  $('#drawer-title').textContent = 'Add a document';
  const body = $('#drawer-body');
  body.innerHTML = `
    <form class="ev-form" id="ev-form">
      <label>What is it?
        <select name="kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>Name
        <input name="title" required maxlength="120" placeholder="e.g. Signed website contract" />
      </label>
      <label>Paste the text
        <textarea name="text" rows="12" required placeholder="Paste the contract, the email thread, or the download log here."></textarea>
      </label>
      <div class="ev-file">or <label class="linkbtn" for="ev-file-input">choose a text file</label> (.txt, .eml, .csv, .md). For a PDF, copy its text and paste it above.
        <input type="file" id="ev-file-input" accept=".txt,.text,.eml,.csv,.md,.log,.json" hidden />
      </div>
      <p class="faint" style="font-size:13px;margin:0">We split it into numbered sections, so every sentence in your response can point to the exact place it comes from.</p>
      <div style="display:flex;gap:8px"><button class="btn primary" type="submit">Add to evidence</button><button class="btn" type="button" id="ev-cancel">Cancel</button></div>
    </form>`;
  const form = $('#ev-form');
  $('#ev-cancel').onclick = closeDrawer;
  $('#ev-file-input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    form.text.value = await f.text();
    if (!form.title.value) form.title.value = f.name.replace(/\.[^.]+$/, '');
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const r = await api(`/api/cases/${encodeURIComponent(state.current.id)}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: form.kind.value, title: form.title.value, text: form.text.value }),
      });
      closeDrawer();
      await reloadEvidence();
      toast(`Added "${r.title}" (${r.sections} sections). Run the agent to use it.`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  };
  showDrawer();
  setTimeout(() => form.title.focus(), 200);
}

function markDoc(docId, cls) {
  const el = $(`#locker [data-doc="${CSS.escape(docId)}"]`);
  if (!el) return;
  el.classList.add(cls);
  el.classList.remove('pulse');
  void el.offsetWidth; // restart the animation
  el.classList.add('pulse');
}

function renderControls(c) {
  const ctl = $('#controls');
  ctl.innerHTML = `
    <button class="btn primary" id="run-live">Find out what's really going on</button>
    <button class="btn" id="run-replay" ${c.has_replay ? '' : 'disabled title="No recorded run yet"'}>Watch a recorded run</button>
    <span class="hint">The agent reads your contract, emails and logs. A live run takes a few minutes; the recording plays in about one.</span>`;
  $('#run-live').onclick = () => startRun('live');
  $('#run-replay').onclick = () => startRun('replay');

  // Live sandbox disputes: buttons to move the dispute through PayPal's lifecycle while testing.
  if (c.live && state.status?.paypal.env === 'sandbox') {
    const tools = h(`<details class="sandbox" style="width:100%"><summary>Developer tools (PayPal sandbox)</summary>
        <span>Stage ${esc(c.dispute.dispute_life_cycle_stage)} · status ${esc(c.dispute.status)}</span>
        <button class="btn" data-a="escalate">Escalate to claim</button>
        <button class="btn" data-a="require-evidence">Require seller evidence</button>
        <button class="btn" data-a="adjudicate" data-o="SELLER_FAVOR">Settle: freelancer wins</button>
      </details>`);
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

// ---------- the agent's steps ----------------------------------------------------

const STAGES = [
  ['intake', 'Pull the dispute from PayPal'],
  ['read', 'Read what your client said'],
  ['investigate', 'Go through your evidence'],
  ['diagnose', "Work out what's really wrong"],
  ['strategy', 'Choose a plan'],
  ['draft', 'Write your response'],
  ['verify', 'Check every quote against its source'],
  ['package', 'Get it ready to send through PayPal'],
];

function renderTrailSkeleton() {
  const ol = $('#trail');
  ol.innerHTML = '';
  STAGES.forEach(([key, title], i) => {
    ol.appendChild(
      h(`<li class="stage pending" data-stage="${key}">
          <span class="dot">${i + 1}</span>
          <div class="title" role="button" tabindex="0"><span>${esc(title)}</span><span class="sum"></span><span class="more">Details</span></div>
          <div class="stage-body"></div>
        </li>`)
    );
  });
  $('#trail-note').textContent = '';
}

const stageEl = (key) => $(`#trail [data-stage="${key}"]`);
const stageBody = (key) => $('.stage-body', stageEl(key));
const stageSum = (key, text) => ($('.sum', stageEl(key)).textContent = text);
function setStage(key, status) {
  const el = stageEl(key);
  if (!el) return;
  el.classList.remove('pending', 'running', 'done');
  el.classList.add(status === 'start' ? 'running' : 'done');
  if (key === 'package' && status !== 'start') el.classList.add('final');
  if (status === 'start') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // A finished step folds down to its one-line summary; "Details" opens it again.
  // In judge mode, the two stages that carry the actual reasoning stay open so nobody
  // has to click to see them.
  const keepOpen = state.keepStagesOpen && (key === 'diagnose' || key === 'verify');
  if (status !== 'start' && key !== 'package' && !keepOpen) setTimeout(() => el.classList.add('collapsed'), 1500);
}

// Clicking a step's title opens or folds its details.
document.addEventListener('click', (e) => {
  const t = e.target.closest('.stage.done .title');
  if (t) t.parentElement.classList.toggle('collapsed');
});
document.addEventListener('keydown', (e) => {
  const t = e.key === 'Enter' || e.key === ' ' ? e.target.closest?.('.stage.done .title') : null;
  if (t) {
    e.preventDefault();
    t.parentElement.classList.toggle('collapsed');
  }
});

function chip(c, kind = '') {
  const isPP = c.doc_id === 'DISPUTE' || c.doc_id.startsWith('PAYPAL');
  const el = h(`<button class="chip ${isPP ? 'paypal' : ''} ${kind}">${esc(sourceName(c))}</button>`);
  el.onclick = () => openDrawer(c.doc_id, c.anchor, c.quote);
  return el;
}
function chips(list, kind) {
  const wrap = h('<div class="chips"></div>');
  (list || []).forEach((c) => wrap.appendChild(chip(c, kind)));
  return wrap;
}

function startRun(mode) {
  clearTimeout(state.judgeAutoplayTimer); // a manual click always wins over the pending auto-play
  if (state.stream) state.stream.close();
  renderTrailSkeleton();
  renderThree(state.current);
  $('#result').classList.add('hidden');
  $('#result').innerHTML = '';
  $('#locker').querySelectorAll('.doc').forEach((d) => d.classList.remove('opened', 'cited'));
  $('#run-live').disabled = true;
  $('#run-replay').disabled = true;
  let currentStage = 'intake';
  let opened = 0;
  let found = 0;

  const es = new EventSource(`/api/cases/${encodeURIComponent(state.current.id)}/run?mode=${mode}`);
  state.stream = es;
  const on = (type, fn) => es.addEventListener(type, (e) => fn(JSON.parse(e.data)));

  on('mode', (p) => {
    $('#trail-note').textContent =
      p.mode === 'replay' ? `Recording of a real run from ${new Date(p.recorded_at).toLocaleDateString()}, sped up` : 'Running live';
  });
  on('stage', (p) => {
    currentStage = p.stage;
    setStage(p.stage, p.status);
    if (p.status === 'done') renderStageDone(p.stage, p.data || {}, p.thinking);
  });
  on('thinking', (p) => addRawNotes(p.stage, p.text));
  on('tool', (p) => {
    const body = stageBody('investigate');
    if (p.name === 'read_document') {
      opened++;
      markDoc(p.doc_id, 'opened');
      body.appendChild(h(`<div class="step-line">Opened <b>${esc(p.title)}</b></div>`));
    } else if (p.name === 'search_evidence') {
      body.appendChild(h(`<div class="step-line">Searched for <b>"${esc(p.query)}"</b>, ${p.hits.length} matches</div>`));
    }
    stageSum('investigate', `${opened} documents opened, ${found} findings`);
  });
  on('finding', (p) => {
    found++;
    p.citations.forEach((c) => markDoc(c.doc_id, 'cited'));
    const card = h(`<div class="finding"><div class="f-text">${say(p.finding)}</div><div class="f-why">${say(p.significance)}</div></div>`);
    card.appendChild(chips(p.citations));
    stageBody('investigate').appendChild(card);
    stageSum('investigate', `${opened} documents opened, ${found} findings`);
  });
  on('pacing', (p) => {
    const el = h(`<div class="pacing"><span class="spin"></span>Waiting ${Math.round(p.ms / 1000)}s for the AI service (free-tier limit)</div>`);
    stageBody(currentStage).appendChild(el);
    setTimeout(() => el.remove(), p.ms);
  });
  on('verify_issue', (p) => {
    const card = h(`<div class="panel"><h4>${p.failed.length} sentence(s) didn't match their source exactly, so the agent is fixing them</h4></div>`);
    const list = h('<div class="raw"></div>');
    list.textContent = p.failed.map((f) => `✗ "${f.text}"\n   ${f.problems.join('; ') || 'no source given'}`).join('\n');
    const toggle = h('<button class="raw-toggle">Show which ones</button>');
    toggle.onclick = () => list.classList.toggle('open');
    card.append(toggle, list);
    stageBody('verify').appendChild(card);
  });
  on('result', (r) => renderResult(r));
  on('fatal', (p) => {
    stageBody(currentStage).appendChild(h(`<div class="banner warn"><b>Stopped:</b> ${esc(p.message)}</div>`));
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

// The model's raw scratchpad, tucked away behind a toggle.
function addRawNotes(stage, text) {
  const body = stageBody(stage);
  if (!text || !body) return;
  // One toggle per step: later notes for the same step are added to the same box.
  const existing = $('.raw.notes', body);
  if (existing) {
    existing.textContent += `\n\n${text}`;
    return;
  }
  const box = h('<div class="raw notes"></div>');
  box.textContent = text;
  const btn = h("<button class=\"raw-toggle\">Show the AI's raw notes</button>");
  btn.onclick = () => box.classList.toggle('open');
  body.append(btn, box);
}

function renderStageDone(stage, data, thinking) {
  const body = stageBody(stage);

  if (stage === 'intake') {
    stageSum('intake', `${data.documents.length} documents, ${data.documents.reduce((n, d) => n + d.sections, 0)} quotable sections`);
    // Shows which of this run's facts came from a real, live PayPal API call just now,
    // versus a seeded demo record or something typed in - so "PayPal is in the data" isn't
    // just a claim in the README.
    const real = (s) => /\(sandbox, live\)/.test(s || '');
    const row = (label, src) =>
      `<div class="pp-row ${real(src) ? 'live' : ''}"><span class="pp-dot"></span><b>${esc(label)}</b><span class="pp-src">${esc(src || 'Not used for this case')}</span></div>`;
    body.appendChild(
      h(`<div class="panel"><h4>PayPal APIs used for this case</h4>
          ${row('Disputes API', data.sources?.dispute)}
          ${row('Transaction Search API', data.sources?.transactions)}
        </div>`)
    );
  }

  if (stage === 'read') {
    stageSum('read', `${data.vague_phrases.length} vague phrases to check`);
    const v = h('<div class="panel"><h4>Vague phrases: where the real problem may be hiding</h4><div class="vague"></div></div>');
    data.vague_phrases.forEach((p) => {
      $('.vague', v).appendChild(h(`<span class="ph">"${esc(p.phrase)}"</span>`));
      $('.vague', v).appendChild(h(`<span class="mean">could mean: ${p.could_mean.map(esc).join(' · ')}</span>`));
    });
    body.appendChild(v);
    body.appendChild(h(`<div class="panel"><h4>Questions to answer from the evidence</h4><ul class="qlist">${data.open_questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>`));
    highlightStatement(data.vague_phrases.map((p) => p.phrase));
  }

  if (stage === 'investigate') {
    stageSum('investigate', `${data.opened.length} documents opened, ${data.findings} findings`);
    if (data.summary) body.appendChild(h(`<div class="panel"><h4>In short</h4><div>${esc(data.summary)}</div></div>`));
  }

  if (stage === 'diagnose') {
    stageSum('diagnose', `${data.real_complaint.confidence}% sure`);
    // Fill card 2 at the top of the page.
    const real = $('#card-real');
    // The "aha" moment: the card pops, rings gold once, and the finding appears word by word.
    real.className = 'real reveal';
    const words = say(data.real_complaint.summary).split(' ').map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(' ');
    real.innerHTML = `
      <span class="kicker">2 · What's actually going on</span>
      <p class="big">${words}</p>
      <div class="meter"><span class="track"><i></i></span>${data.real_complaint.confidence}% sure</div>
      <span class="note">What they need: ${say(data.real_complaint.what_the_client_actually_needs)}</span>`;
    requestAnimationFrame(() => ($('.meter i', real).style.width = `${data.real_complaint.confidence}%`));

    // Older recordings predate this field.
    if (data.client_concerns?.length) {
      const cs = h('<div class="panel"><h4>What your client is worried about, and the answer</h4></div>');
      data.client_concerns.forEach((x) => {
        const row = h(`<div class="concern"><div><b>${say(x.concern)}</b></div><div class="h-exp">${say(x.answer)}</div></div>`);
        row.appendChild(chips([...x.said_in, ...x.answered_by]));
        cs.appendChild(row);
      });
      body.appendChild(cs);
    }

    const top = data.hypotheses[0];
    const hyps = h('<div class="panel"><h4>Theories the agent weighed</h4></div>');
    data.hypotheses.forEach((hy) => {
      const row = h(`
        <div class="hyp ${hy === top ? 'top' : ''}">
          <div><div class="h-label">${esc(hy.label)}</div><div class="h-exp">${say(hy.explanation)}</div></div>
          <div><div class="h-bar"><i></i></div><div class="h-pct">${hy.likelihood}%</div></div>
        </div>`);
      if (hy.supporting.length) row.firstElementChild.appendChild(chips(hy.supporting));
      if (hy.contradicting.length) row.firstElementChild.appendChild(chips(hy.contradicting, 'against'));
      hyps.appendChild(row);
      requestAnimationFrame(() => ($('.h-bar i', row).style.width = `${hy.likelihood}%`));
    });
    body.appendChild(hyps);
    body.appendChild(h(`<div class="panel"><h4>Why they filed it as "${esc(REASONS[state.current.dispute.reason] || '')}"</h4><div>${say(data.why_this_reason_code)}</div></div>`));
    if (data.freelancer_weaknesses.length) {
      const w = h('<div class="panel"><h4>Where your side is weaker (good to know before you respond)</h4></div>');
      data.freelancer_weaknesses.forEach((x) => {
        const row = h(`<div><div>${say(x.issue)}</div></div>`);
        row.appendChild(chips(x.citations, 'against'));
        w.appendChild(row);
      });
      body.appendChild(w);
    }
  }

  if (stage === 'strategy') {
    const d = DECISIONS[data.decision] || { short: data.decision, long: '' };
    stageSum('strategy', d.short);
    const plan = $('#card-plan');
    plan.className = '';
    plan.innerHTML = `
      <span class="kicker">3 · What we'll do about it</span>
      <p class="big">${esc(d.long)}</p>
      ${data.resolution_action && data.resolution_action !== 'none' ? `<span class="note">${esc(clipSentence(data.resolution_action, 190))}</span>` : ''}
      ${refundOf(data) > 0 ? `<span class="tag amber" style="align-self:flex-start">Refund ${fmtMoney(refundOf(data), state.current.dispute.dispute_amount?.currency_code)}</span>` : ''}`;
    body.appendChild(h(`<div class="panel"><h4>Why</h4><div>${say(data.rationale)}</div></div>`));
    const pp = h('<div class="panel"><h4>What the response has to prove</h4></div>');
    const ANS = { STATED_REASON: 'For the bank', REAL_COMPLAINT: 'For your client', BOTH: 'For both' };
    data.proof_plan.forEach((p) => {
      const row = h(`<div class="plan-row"><span class="tag ${p.answers === 'REAL_COMPLAINT' ? 'blue' : p.answers === 'BOTH' ? 'green' : ''}">${esc(ANS[p.answers] || p.answers)}</span><div>${say(p.point)}</div><span class="strength ${esc(p.strength)}">${esc(String(p.strength || '').toLowerCase())}</span></div>`);
      row.children[1].appendChild(chips(p.evidence));
      pp.appendChild(row);
    });
    body.appendChild(pp);
  }

  if (stage === 'draft') stageSum('draft', `${data.claims} statements, each with its source`);

  if (stage === 'verify') {
    stageSum('verify', `${data.grounded} of ${data.total} match word for word`);
    body.appendChild(
      h(`<div class="panel" style="flex-direction:row;align-items:center;gap:14px;flex-wrap:wrap">
          <span class="verify-big">${data.grounded}/${data.total}</span>
          <span>statements verified. Every quote was checked against the exact document it cites (by plain code, not AI)${data.repaired ? `; ${data.repaired} fixed along the way` : ''}${data.removed.length ? `; <b style="color:var(--danger)">${data.removed.length} removed</b> because no source supported them` : ''}.</span>
        </div>`)
    );
  }

  if (thinking) addRawNotes(stage, thinking);
}

// Highlight the vague phrases inside the client's statement (card 1).
function highlightStatement(phrases) {
  const q = $('#said');
  if (!q) return;
  let html = esc(q.textContent);
  for (const p of phrases) {
    const safe = esc(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(safe, 'i'), (m) => `<mark>${m}</mark>`);
  }
  q.innerHTML = html;
}

// ---------- the response ------------------------------------------------------------

function renderResult(r) {
  const pkg = r.package;
  const c = state.current;
  c.result = r;
  stageSum('package', 'Ready');
  setStage('package', 'done');

  const key = (x) => `${x.doc_id} ${x.anchor}`;
  const notes = pkg.footnotes;
  const out = $('#result');
  out.classList.remove('hidden');
  out.innerHTML = '';

  const top = h('<div class="result"></div>');

  // The letter to the bank, with numbered sources.
  const letter = h(`<div class="card letter">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <span class="kicker">Your response to the bank</span>
        <span class="tag green">${r.draft.claims.length} of ${r.draft.claims.length + (r.removed || []).length} statements verified</span>
      </div>
      <h3>${esc(r.draft.response_title)}</h3>
      <div class="lmeta">From ${esc(c.freelancer.name)}. Every sentence links to the document it comes from.</div>
    </div>`);

  // "Explain this to me": an on-demand, plain-English rewrite of the same (already
  // verified) points, for the freelancer reading their own letter, not the bank. A
  // recorded run can ship with this baked in (r.plainExplanation) so it shows at once,
  // already open, with no click and no live Groq call needed.
  const baked = r.plainExplanation;
  const SHOW_TXT = '💬 Explain this to me in plain English';
  const HIDE_TXT = '💬 Hide the plain-English version';
  const explainBox = h(`<div class="panel explain${baked ? '' : ' hidden'}"></div>`);
  const explainBtn = h(`<button class="btn explain-toggle">${baked ? HIDE_TXT : SHOW_TXT}</button>`);
  if (baked) {
    explainBox.innerHTML = baked.map((p) => `<p>${esc(p)}</p>`).join('');
    explainBox.dataset.loaded = '1';
  }
  explainBtn.onclick = async () => {
    const open = explainBox.classList.toggle('hidden') === false;
    explainBtn.textContent = open ? HIDE_TXT : SHOW_TXT;
    // Only fetch the first time it's opened; a click while already loading, or after it
    // loaded (live or baked) or failed, just toggles visibility (retry a failure by
    // closing and reopening).
    if (!open || explainBox.dataset.loaded || explainBox.dataset.loading) return;
    explainBox.dataset.loading = '1';
    explainBox.innerHTML = '<div class="pacing"><span class="spin"></span>Putting this in plain words…</div>';
    try {
      const { paragraphs } = await api(`/api/cases/${encodeURIComponent(c.id)}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      explainBox.innerHTML = paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
      explainBox.dataset.loaded = '1';
    } catch (err) {
      explainBox.innerHTML = `<p class="faint">${esc(err.message)}</p>`;
    } finally {
      delete explainBox.dataset.loading;
    }
  };
  letter.append(explainBtn, explainBox);

  // Short by default: the first few points, the rest behind "Read the full letter".
  const SHOW = 3;
  const rest = h('<div class="hidden"></div>');
  r.draft.claims.forEach((cl, i) => {
    const p = h(`<p>${esc(cl.text)}</p>`);
    // One chip per document, even when a sentence quotes it several times.
    const seen = new Set();
    cl.citations.forEach((x) => {
      if (seen.has(x.doc_id)) return;
      seen.add(x.doc_id);
      const b = h(`<button class="fn" title="${esc(docName(x.doc_id) + ' · ' + anchorName(x.anchor))}">${esc(docName(x.doc_id))}</button>`);
      b.onclick = () => openDrawer(x.doc_id, x.anchor, x.quote);
      p.appendChild(b);
    });
    (i < SHOW ? letter : rest).appendChild(p);
  });
  (r.removed || []).forEach((cl) => rest.appendChild(h(`<p class="removed" title="Removed: no source supported it">${esc(cl.text)}</p>`)));
  if (rest.children.length) {
    const more = h(`<button class="linkbtn">Read the full letter (${r.draft.claims.length} points)</button>`);
    more.onclick = () => {
      rest.classList.toggle('hidden');
      more.textContent = rest.classList.contains('hidden') ? `Read the full letter (${r.draft.claims.length} points)` : 'Show less';
      letter.appendChild(more); // keep the toggle below the text
    };
    letter.append(rest, more);
  }
  letter.appendChild(
    h(`<div class="files"><a href="/api/cases/${encodeURIComponent(c.id)}/files/response-letter.pdf" target="_blank">Download letter (PDF)</a><a href="/api/cases/${encodeURIComponent(c.id)}/files/evidence-appendix.pdf" target="_blank">Download evidence appendix (PDF)</a></div>`)
  );
  top.appendChild(letter);

  // Right column: the message to the client + what gets sent to PayPal.
  const side = h('<div style="display:flex;flex-direction:column;gap:12px"></div>');
  side.appendChild(h(`<div class="card"><span class="kicker">Message to ${esc(c.client.name)}</span><div class="msg" style="margin-top:8px">${esc(pkg.clientMessage)}</div></div>`));
  const actions = h('<div class="card"><span class="kicker">What gets sent</span></div>');
  pkg.actions.forEach((a) => {
    actions.appendChild(
      h(`<div class="action" data-kind="${esc(a.kind)}">
          <div><div class="a-label">${esc(a.label)}</div><div class="a-note">${a.kind === 'email' ? esc(a.note) : 'Through the PayPal Disputes API'}</div></div>
          <div class="a-state a-note">${a.kind === 'email' ? 'You send this one' : 'Ready'}</div>
        </div>`)
    );
  });
  side.appendChild(actions);
  top.appendChild(side);
  out.appendChild(top);
  out.appendChild(renderLedger(r, notes, key));

  // The big send bar.
  const cta = h(`<div class="cta">
      <div><div class="t">Your response is ready to send.</div><div class="s">${c.live ? 'This sends it to PayPal (sandbox).' : "This is a demo dispute, so sending shows exactly what would go to PayPal."}</div></div>
      <div class="btns">
        <button class="btn ghost-dark" id="to-top">Review the steps</button>
        <button class="btn white" id="send">Send response →</button>
      </div>
    </div>`);
  out.appendChild(cta);
  $('#to-top', cta).onclick = () => $('#trail').scrollIntoView({ behavior: 'smooth' });
  $('#send', cta).onclick = () => doSubmit(cta, actions);
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Evidence ledger (AG Grid): one row per source behind the response, to audit it at a glance.
function renderLedger(r, notes, key) {
  const docs = Object.fromEntries(state.current.documents.map((d) => [d.doc_id, d]));
  const rows = [];
  r.draft.claims.forEach((cl, i) =>
    cl.citations.forEach((x) =>
      rows.push({
        claim: i + 1,
        text: cl.text,
        doc_id: x.doc_id,
        source: docs[x.doc_id]?.title || x.doc_id,
        origin: docs[x.doc_id]?.kind === 'paypal_record' ? 'PayPal' : 'Your records',
        anchor: x.anchor,
        quote: clip(x.quote, 220),
        verified: true,
      })
    )
  );
  (r.removed || []).forEach((cl) => rows.push({ claim: '—', text: cl.text, doc_id: '', source: '', origin: '', anchor: '', quote: '', verified: false }));

  const n = rows.filter((x) => x.verified).length;
  const wrapEl = h(`<div class="card">
      <div class="card-head" style="margin-bottom:0"><h2>Your evidence, checked</h2><button class="btn" id="ledger-toggle">Show details</button></div>
      <div class="ev-body hidden">
        <div class="tabs" role="tablist">
          <button class="tab on" role="tab" data-tab="docs">What each document proves</button>
          <button class="tab" role="tab" data-tab="quotes">Every quote checked (${n})</button>
        </div>
        <div class="matrix ag-theme-quartz grid" data-pane="docs"></div>
        <div class="ledger ag-theme-quartz grid hidden" data-pane="quotes"></div>
      </div>
    </div>`);
  const evBody = $('.ev-body', wrapEl);
  $('#ledger-toggle', wrapEl).onclick = (e) => {
    evBody.classList.toggle('hidden');
    e.target.textContent = evBody.classList.contains('hidden') ? 'Show details' : 'Hide details';
  };
  wrapEl.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      wrapEl.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      wrapEl.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
    };
  });
  agGrid.createGrid($('.matrix', wrapEl), evidenceMatrix(r));
  const grid = $('.ledger', wrapEl);
  agGrid.createGrid(grid, {
    rowData: rows,
    domLayout: 'autoHeight',
    defaultColDef: { sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true, wrapText: true, autoHeight: true },
    columnDefs: [
      { headerName: '#', field: 'claim', width: 70 },
      { headerName: 'Statement', field: 'text', flex: 2, minWidth: 220, cellStyle: { lineHeight: '1.45', paddingTop: '10px', paddingBottom: '10px' } },
      {
        headerName: 'Source',
        field: 'source',
        flex: 1.2,
        minWidth: 180,
        cellRenderer: (p) => (p.value ? `<div class="cell-stack"><span class="main" style="font-size:14px">${esc(p.value)}</span><span class="sub">${esc(sourceName(p.data))}</span></div>` : ''),
      },
      { headerName: 'From', field: 'origin', width: 130, cellRenderer: (p) => (p.value ? `<span class="tag ${p.value === 'PayPal' ? 'blue' : ''}">${esc(p.value)}</span>` : '') },
      { headerName: 'Exact quote', field: 'quote', flex: 2, minWidth: 220, cellStyle: { lineHeight: '1.45', paddingTop: '10px', paddingBottom: '10px', fontStyle: 'italic', color: '#475569' } },
      {
        headerName: 'Check',
        field: 'verified',
        width: 120,
        valueFormatter: (p) => (p.value ? 'verified' : 'removed'),
        cellRenderer: (p) => (p.value ? '<span class="ok">✓ Verified</span>' : '<span class="bad">✗ Removed</span>'),
      },
    ],
    onRowClicked: (e) => e.data.doc_id && openDrawer(e.data.doc_id, e.data.anchor, e.data.quote),
  });
  return wrapEl;
}

// One row per document: what the investigation found in it, how often the response leans on
// it, and whether it cuts against the freelancer. Sort by "Used in response" to see the backbone.
function evidenceMatrix(r) {
  const count = (refs) => refs.reduce((m, x) => m.set(x.doc_id, (m.get(x.doc_id) || 0) + 1), new Map());
  const used = count(r.draft.claims.flatMap((c) => c.citations));
  const against = count(r.diagnosis.freelancer_weaknesses.flatMap((w) => w.citations));
  const rows = state.current.documents.map((d) => {
    const found = r.findings.filter((f) => f.citations.some((c) => c.doc_id === d.doc_id)).map((f) => f.finding);
    return {
      doc_id: d.doc_id,
      title: d.title,
      origin: d.kind === 'paypal_record' ? 'PayPal' : d.added ? 'Added by you' : 'Your records',
      proves: found[0] || '',
      more: found.length - 1,
      used: used.get(d.doc_id) || 0,
      against: against.get(d.doc_id) || 0,
    };
  });
  return {
    rowData: rows,
    domLayout: 'autoHeight',
    defaultColDef: { sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: true },
    columnDefs: [
      {
        headerName: 'Document',
        field: 'title',
        flex: 1.3,
        minWidth: 200,
        wrapText: true,
        autoHeight: true,
        cellStyle: { lineHeight: '1.4', paddingTop: '10px', paddingBottom: '10px' },
        cellRenderer: (p) => `<div class="cell-stack"><span class="main" style="font-size:14px">${esc(p.value)}</span><span class="sub">${esc(p.data.origin)}</span></div>`,
      },
      {
        headerName: 'What it shows',
        field: 'proves',
        flex: 2.2,
        minWidth: 260,
        wrapText: true,
        autoHeight: true,
        cellStyle: { lineHeight: '1.45', paddingTop: '10px', paddingBottom: '10px' },
        cellRenderer: (p) =>
          p.value
            ? `<span style="font-size:14px">${say(clipSentence(p.value, 170))}</span>${p.data.more > 0 ? ` <span class="faint" style="font-size:12px">+${p.data.more} more</span>` : ''}`
            : '<span class="faint">Nothing the response needed</span>',
      },
      {
        headerName: 'Cited',
        headerTooltip: 'How many times your response quotes this document',
        field: 'used',
        width: 120,
        sort: 'desc',
        type: 'numericColumn',
        cellRenderer: (p) => (p.value ? `<span class="count">${p.value}×</span>` : '<span class="faint">—</span>'),
      },
      {
        headerName: 'Risk',
        headerTooltip: 'Does this document also show a weak point on your side?',
        field: 'against',
        width: 120,
        valueFormatter: (p) => (p.value ? 'Yes' : 'No'),
        cellRenderer: (p) => (p.value ? '<span class="tag amber">Has a weak spot</span>' : '<span class="faint">No</span>'),
      },
    ],
    onRowClicked: (e) => openDrawer(e.data.doc_id),
  };
}

// What actually happened, in the one headline everybody actually reads. "email" isn't a
// PayPal outcome (the freelancer sends that one themselves), so it's left out here.
function submitOutcome(res) {
  const real = res.results.filter((r) => r.kind !== 'email');
  const failed = real.filter((r) => !r.ok && !r.skipped);
  const skipped = real.filter((r) => r.skipped);
  const sent = real.filter((r) => r.ok && !r.simulated);
  if (failed.length) return { t: "Something didn't go through", s: "One or more actions hit an error — see \"Show the exact API request\" on each one below.", cls: 'bad' };
  if (!real.length) return { t: 'Nothing for PayPal here', s: 'This response had nothing for PayPal to receive — just the message below, which you send yourself.', cls: 'warn' };
  if (!res.live) return { t: 'Simulated: nothing was actually sent', s: "This demo dispute doesn't exist inside PayPal, so there was nothing real to send it to. Each item below shows the exact request that would have gone out — click \"Show the exact API request\" to see it.", cls: 'ok' };
  if (skipped.length) return { t: sent.length ? 'Partially sent to PayPal' : 'Not sent yet', s: "PayPal isn't ready for one or more of these actions at this dispute's current stage — see below for which, and why.", cls: 'warn' };
  return { t: 'Sent to PayPal', s: "Your response was submitted for real, through PayPal's own Disputes API.", cls: 'ok' };
}

async function doSubmit(cta, actionsCard) {
  const btn = $('#send', cta);
  btn.disabled = true;
  btn.textContent = 'Sending…';
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
        ? `<span class="a-note">${esc(r.error)}</span>`
        : r.ok
          ? `<span class="ok">✓ ${r.simulated ? 'Simulated' : 'Sent to PayPal'}</span>`
          : `<span class="bad">✗ ${esc(r.error)}</span>`;
      if (r.request) {
        const pre = h('<pre class="req hidden"></pre>');
        pre.textContent =
          JSON.stringify(r.request, null, 2) +
          (r.response ? `\n\n// PayPal response\n${JSON.stringify(r.response, null, 2)}` : '') +
          (r.paypal ? `\n\n// PayPal error\n${JSON.stringify(r.paypal, null, 2)}` : '');
        const t = h('<button class="raw-toggle" style="width:100%">Show the exact API request</button>');
        t.onclick = () => pre.classList.toggle('hidden');
        row.append(t, pre);
      }
    }
    // The headline itself now says what happened, not what was about to happen - that's
    // the one piece of text on this page everyone actually reads.
    const outcome = submitOutcome(res);
    cta.classList.add('sent', outcome.cls);
    $('.t', cta).textContent = outcome.t;
    $('.s', cta).textContent = outcome.s;
    btn.textContent = outcome.cls === 'bad' ? 'Try again' : outcome.t;
    btn.disabled = outcome.cls !== 'bad';
    toast(outcome.t);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Try again';
    toast(err.message);
  }
}

// ---------- source document drawer ---------------------------------------------------

async function openDrawer(docId, anchor, quote) {
  const doc = await api(`/api/cases/${encodeURIComponent(state.current.id)}/documents/${encodeURIComponent(docId)}`).catch(() => null);
  if (!doc) return;
  $('#drawer-kicker').textContent = doc.source;
  $('#drawer-title').textContent = doc.title;
  const body = $('#drawer-body');
  body.innerHTML = '';
  // Opened from a citation: show only the passage that backs it, the rest on request.
  const focus = anchor && doc.sections.some((s) => s.anchor === anchor);
  if (focus) body.appendChild(h('<div class="drawer-why">This is the part of the document your response relies on.</div>'));
  let target = null;
  for (const s of doc.sections) {
    let text = esc(s.text);
    if (s.anchor === anchor && quote) {
      for (const piece of quote.split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length > 3)) {
        const safe = esc(piece.replace(/^["']|["']$/g, '')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(safe, 'i'), (m) => `<mark>${m}</mark>`);
      }
    }
    // Only contract sections are referred to by number; other anchors (E4, L5, IDs) mean nothing to a reader.
    // Skip a heading that just repeats the start of the text (common in pasted messages and logs).
    const repeats = s.text.startsWith(s.heading.replace(/\.\.\.$/, ''));
    const title = s.fields ? '' : /^§/.test(s.anchor) ? `${anchorName(s.anchor)} · ${s.heading}` : repeats ? '' : s.heading;
    const bodyHtml = s.fields
      ? `<dl class="fields">${s.fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      : `<div class="st">${text}</div>`;
    const el = h(`<div class="sec ${s.anchor === anchor ? 'hl' : ''} ${focus && s.anchor !== anchor ? 'hidden other' : ''}">${title ? `<div class="sh">${esc(title)}</div>` : ''}${bodyHtml}</div>`);
    if (s.anchor === anchor) target = el;
    body.appendChild(el);
  }
  if (focus && doc.sections.length > 1) {
    const all = h(`<button class="linkbtn">Show the whole document (${doc.sections.length} sections)</button>`);
    all.onclick = () => {
      body.querySelectorAll('.sec.other').forEach((el) => el.classList.remove('hidden'));
      all.remove();
      target.scrollIntoView({ block: 'center' });
    };
    body.appendChild(all);
  }
  showDrawer();
  if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

// The closed drawer is `inert`, so Tab can't reach it; opening it moves focus inside.
function showDrawer() {
  const d = $('#drawer');
  d.inert = false;
  d.classList.add('open');
  $('#scrim').classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  state.drawerReturn = document.activeElement;
  $('#drawer-close').focus({ preventScroll: true });
}

function closeDrawer() {
  const d = $('#drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open');
  $('#scrim').classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  d.inert = true;
  state.drawerReturn?.focus?.({ preventScroll: true });
}
