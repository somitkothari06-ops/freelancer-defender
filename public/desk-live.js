// Live data layer for Defender Desk. The desktop chrome lives in desk.html;
// case facts and source text always come from the same API as the main app.
(() => {
  const core = window.liveDeskCore;
  const { state, apps, svg, escapeHtml: esc, openApp, renderApp, renderDesktop, refreshDock, bindApp, toast } = core;
  const local = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const mine = local('fd-my-cases', []).filter(id => /^[A-Za-z0-9-]{1,64}$/.test(id)).slice(0, 20);
  const q = (id) => encodeURIComponent(id);
  const api = async (path) => { const response = await fetch(path); if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`); return response.json(); };
  const money = (row) => `${new Intl.NumberFormat('en-US', { style: 'currency', currency: row?.currency || 'USD', maximumFractionDigits: 2 }).format(row?.amount || 0)}`;
  const reason = (code) => ({ MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described', MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Service not received', UNAUTHORISED: 'Unauthorized', CREDIT_NOT_PROCESSED: 'Credit not processed' })[code] || String(code || 'Reason unavailable').replaceAll('_', ' ').toLowerCase();
  const caseKey = (suffix) => `fd-desk-${state.caseId}-${suffix}`;
  const selected = () => state.cases?.find(c => c.dispute_id === state.caseId);
  const doc = () => state.caseDetail?.documents?.find(d => d.doc_id === state.sourceDoc);
  const isSeeded = () => selected()?.source === 'seeded';
  const sourceLabel = () => !selected() ? 'Loading case' : isSeeded() ? 'Seeded demo record' : selected()?.source === 'live' ? 'PayPal sandbox case' : 'Your entered case';
  const link = () => `/app#/case/${q(state.caseId)}`;
  const reviewLink = () => `/app?replay=${q(state.caseId)}#/case/${q(state.caseId)}`;
  const openLink = (url) => { window.location.href = url; };
  const list = () => state.cases || [];
  let selectionSeq = 0;
  const choose = async (id) => {
    if (!list().some(c => c.dispute_id === id)) return;
    const seq = ++selectionSeq;
    state.caseId = id;
    state.caseDetail = null;
    state.detailError = null;
    state.detailLoading = true;
    state.sourceDoc = null;
    state.sourceAnchor = null;
    state.sourceFull = null;
    state.tasks = local(caseKey('tasks'), []);
    state.note = local(caseKey('note'), { title: 'Case notes', body: '' });
    renderApp('case');
    try {
      const detail = await api(`/api/cases/${q(id)}`);
      if (seq !== selectionSeq) return;
      state.caseDetail = detail;
    }
    catch (err) { state.detailError = err.message; toast(err.message); }
    state.detailLoading = false;
    state.sourceDoc = state.caseDetail?.documents?.[0]?.doc_id || null;
    if (state.sourceDoc) {
      try { const full = await api(`/api/cases/${q(id)}/documents/${q(state.sourceDoc)}`); if (seq !== selectionSeq) return; state.sourceFull = full; } catch {}
    }
    apps.case.name = 'Case';
    for (const id of ['files', 'case', 'sources', 'notes', 'tasks']) renderApp(id);
    renderDesktop();
    refreshDock();
    updateWidget();
  };
  const refresh = async () => {
    try {
      const data = await api(`/api/cases${mine.length ? `?mine=${mine.map(q).join(',')}` : ''}`);
      state.cases = data.cases || [];
      state.loadError = null;
      const saved = local('fd-desk-selected', '');
      const id = list().some(c => c.dispute_id === saved) ? saved : (list().find(c => c.hero) || list()[0])?.dispute_id;
      if (id) await choose(id);
      else { state.loadError = 'No cases available'; for (const app of ['files', 'case']) renderApp(app); }
    } catch (err) { state.loadError = err.message; for (const id of ['files', 'case']) renderApp(id); toast(err.message); }
  };
  const buttons = () => `<div class="desk-live-actions"><button class="cta" data-real="investigate">Investigate case</button>${selected()?.has_replay ? `<button class="secondary" data-real="replay">Play recorded review</button>` : ''}<button class="secondary" data-real="create">Create a case</button></div>`;
  const picker = () => `<label class="desk-case-picker">CASE <select id="deskCasePicker" aria-label="Switch case">${list().map(c => `<option value="${esc(c.dispute_id)}" ${c.dispute_id === state.caseId ? 'selected' : ''}>${esc(c.client || c.title || c.dispute_id)} · ${c.source === 'live' ? 'Sandbox' : c.source === 'seeded' ? 'Demo' : 'My case'}</option>`).join('')}</select></label>`;
  const limit = (d) => d?.kind === 'paypal_record' ? 'This is a PayPal record. It does not establish what work was delivered outside PayPal.' : d?.added ? 'Added by the freelancer. Verify the original before submitting.' : 'A source excerpt is evidence of its own wording, not proof of every related claim.';
  function filesHTML() {
    const c = selected();
    if (state.loadError) return `<div class="app-main"><div class="app-kicker">CASE FILES</div><h2 class="app-heading">Cases unavailable</h2><p class="app-sub">${esc(state.loadError)}</p><div class="actions"><button class="cta" data-real="retry">Try again</button></div></div>`;
    if (!state.cases) return `<div class="app-main"><div class="app-kicker">CONNECTING TO CASES</div><h2 class="app-heading">Opening your desk…</h2><p class="app-sub">Loading case records from Freelancer Defender.</p></div>`;
    return `<div class="app-main"><div class="app-kicker">CASE FILES / ${esc(sourceLabel())}</div><div class="desk-headline"><div><h2 class="app-heading">Your case files</h2><p class="app-sub">Choose a case, then inspect its exact records.</p></div>${picker()}</div><div class="file-grid"><button class="file-tile" data-real="case">${svg('case')}<div><strong>${esc(c?.client || 'Case workspace')}</strong><small>${esc(reason(c?.reason))} · ${esc(money(c))}</small></div></button><button class="file-tile" data-real="sources">${svg('file')}<div><strong>Evidence</strong><small>${state.caseDetail?.documents?.length || 0} source records</small></div></button><button class="file-tile" data-real="tasks">${svg('tasks')}<div><strong>Follow-ups</strong><small>${state.tasks.filter(t => !t.done).length} open</small></div></button></div><div class="actions"><button class="secondary" data-real="create">Create a case</button></div><div class="app-rule"></div><div class="app-kicker">AVAILABLE CASES</div><div class="file-list">${list().map(row => `<button class="file-row ${row.dispute_id === state.caseId ? 'desk-selected' : ''}" data-case="${esc(row.dispute_id)}">${svg('case')}<span><strong>${esc(row.client || row.title || row.dispute_id)}</strong><small>${esc(row.title || reason(row.reason))} · ${esc(row.source === 'seeded' ? 'Seeded demo' : row.source === 'live' ? 'Live sandbox' : 'Entered by you')}</small></span><em>${esc(money(row))}</em></button>`).join('')}</div></div>`;
  }
  const sourceName = (id) => ({ CONTRACT: 'Agreement', EMAILS: 'Email', 'DELIVERY-LOG': 'Transfer log', 'CONTACT-FORM': 'Client message' })[id] || id;
  const anchorName = (anchor) => String(anchor).replace(/^§/, 'section ');
  function proofMapHTML(map) {
    const rows = (track) => map.rows.filter(row => row.track === track).map(row => {
      const stateName = { supported: 'In the record', reported: 'Client reports', unknown: 'Not established' }[row.state] || row.state;
      return `<details class="proof-item ${esc(row.state)}"><summary><span class="proof-indicator" aria-hidden="true"></span><strong>${esc(row.title)}</strong><span class="proof-state">${esc(stateName)}</span><span class="proof-expand" aria-hidden="true">+</span></summary><div class="proof-detail"><p>${esc(row.finding)}</p><button type="button" class="record-link" data-proof-doc="${esc(row.source.docId)}" data-proof-anchor="${esc(row.source.anchor)}">Read ${esc(sourceName(row.source.docId))}, ${esc(anchorName(row.source.anchor))}</button></div></details>`;
    }).join('');
    const thread = [
      ['The promise', 'Print masters agreed', map.rows[0]],
      ['The handoff', 'A link was sent', map.rows[1]],
      ['The gap', 'Access unproven', map.rows[2]],
      ['The report', 'Sign-maker concern', map.rows[3]],
    ].map(([label, title, row], index) => `<button class="thread-node ${row.state === 'unknown' ? 'gap' : ''}" data-proof-doc="${esc(row.source.docId)}" data-proof-anchor="${esc(row.source.anchor)}" aria-label="${esc(label)}: ${esc(title)}. Open source"><span class="thread-mark">${index + 1}</span><span class="thread-label">${esc(label)}</span><strong>${esc(title)}</strong></button>`).join('');
    return `<section class="case-focus"><span class="focus-label">Your next move</span><h3>${esc(map.challenge.question)}</h3><p>${esc(map.challenge.reason)}</p><div class="focus-actions"><button class="cta" data-real="investigate">Investigate case</button>${selected()?.has_replay ? '<button class="secondary" data-real="replay">Play recorded review</button>' : ''}<button class="secondary" data-real="add-challenge">Save follow-up</button></div></section><nav class="case-thread" aria-label="Case thread">${thread}</nav><div class="case-records-heading"><h3>What the record shows</h3><span>${map.rows.length} source points</span></div><div class="proof-tracks"><section><h4>Bank response</h4>${rows('Bank response')}</section><section><h4>Client conversation</h4>${rows('Client concern')}</section></div><p class="proof-footnote">Each line opens its source. A client report is shown as a report, not an established fact.</p>`;
  }
  function caseHTML() {
    const c = selected(), detail = state.caseDetail;
    if (state.loadError) return `<div class="app-main"><div class="app-kicker">CASE WORKSPACE</div><h2 class="app-heading">Cases unavailable</h2><p class="app-sub">${esc(state.loadError)}</p><div class="actions"><button class="cta" data-real="retry">Try again</button></div></div>`;
    if (state.detailError) return `<div class="app-main"><div class="app-kicker">CASE WORKSPACE</div><h2 class="app-heading">Case unavailable</h2><p class="app-sub">${esc(state.detailError)}</p><div class="actions"><button class="cta" data-real="retry-detail">Try again</button><button class="secondary" data-real="files">Choose another case</button></div></div>`;
    if (state.detailLoading) return `<div class="app-main"><div class="app-kicker">CASE WORKSPACE</div><h2 class="app-heading">Opening the case…</h2><p class="app-sub">Loading the source records.</p></div>`;
    if (!c) return `<div class="app-main"><h2 class="app-heading">Loading cases…</h2></div>`;
    const clientName = c.client || c.title || '';
    const displayClient = clientName.includes(',') ? clientName.split(',').slice(1).join(',').trim() : clientName;
    const records = detail?.documents || [];
    const nonPayPal = records.filter(d => d.kind !== 'paypal_record');
    const complaint = (detail?.dispute?.messages || []).find(m => m.posted_by === 'BUYER')?.content || (detail?.dispute?.disputed_transactions || []).flatMap(t => t.items || []).map(i => i.notes).find(Boolean);
    const prompts = c.reason === 'UNAUTHORISED' ? [
      ['What connects this client to the work?', 'Check identity, agreement, and signed scope.', /agreement|contract|statement of work|sow/i],
      ['Who approved and used the milestone?', 'Inspect messages and project activity.', /message|email|slack|github|activity/i],
      ['What still needs direct confirmation?', 'The cardholder statement is an allegation until corroborated.', null]
    ] : c.reason === 'CREDIT_NOT_PROCESSED' ? [
      ['What refund was promised?', 'Inspect the written refund or cancellation terms.', /refund|contract|agreement|terms/i],
      ['Was a credit actually processed?', 'Check the payment and refund trail.', /paypal|transaction|refund|payment/i],
      ['What remains unanswered?', 'Separate a request for credit from a completed credit.', null]
    ] : [
      ['What did the agreement promise?', 'Read the contract or statement of work.', /contract|agreement|scope|sow/i],
      ['What delivery can be shown?', 'Check handoff and access records, including their limits.', /deliver|transfer|log|email|message/i],
      ['What remains unverified?', 'Separate the client statement from independently checked facts.', null]
    ];
    const questions = prompts.map(([title, detail, pattern]) => ({ title, detail, ready: !!pattern && records.some(d => d.kind !== 'paypal_record' && pattern.test(`${d.title} ${d.kind}`)) }));
    return `<div class="app-main"><div class="app-kicker">${esc(sourceLabel())} · ${esc(reason(c.reason))}</div><div class="desk-headline"><div><h2 class="app-heading">${esc(displayClient)}</h2><p class="app-sub">${esc(c.title || c.dispute_id)}</p></div><div class="amount"><small>Disputed</small>${esc(money(c))}</div></div>${picker()}<div class="app-rule"></div><details class="desk-claim"><summary><span>Filed reason</span><strong>${esc(reason(c.reason))}</strong><span class="claim-expand">Read statement</span></summary>${complaint ? `<p>${esc(complaint)}</p>` : '<p>No client statement in this case record.</p>'}</details>${detail?.proof_map ? proofMapHTML(detail.proof_map) : `<div class="desk-section-head"><span>Evidence review</span><small>${records.length} records · ${nonPayPal.length} outside PayPal</small></div><div class="desk-gap-list">${questions.map((item, i) => `<button class="desk-gap" data-real="sources"><span class="desk-gap-index">0${i + 1}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><em>${item.ready ? 'SOURCE TO REVIEW' : 'OPEN QUESTION'}</em></button>`).join('')}</div><p class="desk-limit">These are review prompts, not AI conclusions. The full investigation reads the record and produces a sourced strategy.</p>`}${detail?.proof_map ? '<div class="desk-live-actions"><button class="secondary" data-real="create">Create a case</button></div>' : buttons()}</div>`;
  }
  function sourcesHTML() {
    const records = state.caseDetail?.documents || [], d = doc(), full = state.sourceFull;
    return `<div class="app-layout"><aside class="app-side"><div class="side-heading">Evidence locker</div>${records.map(item => `<button class="side-row ${item.doc_id === state.sourceDoc ? 'selected' : ''}" data-doc="${esc(item.doc_id)}">${svg('file')} <span>${esc(item.title)}</span></button>`).join('')}<div class="side-note">${esc(sourceLabel())}. Open the original record before making a factual claim.</div></aside><div class="app-main"><div class="app-kicker">SOURCE INSPECTOR · ${esc(d?.source || '')}</div><h2 class="app-heading">${esc(d?.title || 'Select a record')}</h2><p class="app-sub">${esc(d?.summary || '')}</p>${full ? `<div class="desk-sections">${full.sections.map(s => `<section data-anchor="${esc(s.anchor)}" class="${s.anchor === state.sourceAnchor ? 'source-target' : ''}"><small>${esc(anchorName(s.anchor))}</small><strong>${esc(s.heading)}</strong><p>${esc(s.text)}</p></section>`).join('')}</div>` : '<div class="task-empty">Choose a record to read its exact sections.</div>'}<div class="caution"><strong>Evidence boundary</strong><br>${esc(limit(d))}</div><div class="actions"><button class="secondary" data-real="case">Back to case</button><button class="secondary" data-real="investigate">Open investigation</button></div></div></div>`;
  }
  function notesHTML() { return `<div class="app-main editable-area"><div class="note-toolbar"><span class="app-kicker">PRIVATE NOTES · ${esc(selected()?.client || 'CASE')}</span><span class="save-status" id="noteStatus">Saved in this browser</span></div><input class="note-title" id="noteTitle" aria-label="Note title" value="${esc(state.note.title)}"><textarea class="note-text" id="noteBody" aria-label="Note content" placeholder="What should you remember about this case?">${esc(state.note.body)}</textarea><p class="app-sub" style="margin-top:11px">These notes stay in this browser. They are not sent to PayPal or the AI.</p></div>`; }
  function tasksHTML() { return `<div class="app-main"><div class="app-kicker">PRIVATE FOLLOW-UPS · ${esc(selected()?.client || 'CASE')}</div><h2 class="app-heading">Next steps</h2><p class="app-sub">A personal checklist for this case. No deadline is inferred.</p><form class="task-add" id="taskForm"><input class="task-input" id="taskInput" placeholder="Add a follow-up…" aria-label="New follow-up" required maxlength="180"><button class="cta">Add</button></form><div>${state.tasks.length ? state.tasks.map((t,i) => `<div class="task-row ${t.done ? 'done' : ''}"><input type="checkbox" data-task-check="${i}" ${t.done ? 'checked' : ''} aria-label="Complete ${esc(t.text)}"><span>${esc(t.text)}</span><button data-task-delete="${i}" title="Delete follow-up" aria-label="Delete ${esc(t.text)}">×</button></div>`).join('') : '<div class="task-empty">Nothing due from you yet. Add the next question above.</div>'}</div><p class="app-sub" style="margin-top:22px">Saved only in this browser.</p></div>`; }
  function updateWidget() {
    const metric = document.querySelector('.widget-metrics button:first-child strong');
    if (metric) metric.innerHTML = `${list().length} <i></i>`;
    document.querySelector('.widget-metrics button:first-child span').textContent = 'Cases available';
    document.querySelector('.demo-indicator').innerHTML = `<i></i> ${isSeeded() ? 'SEEDED DEMO' : selected()?.source === 'live' ? 'PAYPAL SANDBOX' : 'YOUR CASE'}`;
    const board = document.getElementById('homeSignal');
    const current = selected();
    const map = state.caseDetail?.proof_map;
    const name = (current?.client || current?.title || 'Your case').split(',').pop().trim();
    board.innerHTML = `<div class="signal-top"><span>CASE SIGNAL</span><span>${esc(isSeeded() ? 'DEMO 01' : 'CURRENT CASE')}</span></div><div class="signal-intro"><small>${esc(reason(current?.reason))}</small><h2>${esc(name)}</h2><p>${esc(current?.title || 'Open the case to inspect its records.')}</p></div>${map ? `<div class="signal-prompt"><span>QUESTION TO RESOLVE</span><strong>${esc(map.challenge.question)}</strong></div><div class="signal-steps">${map.rows.slice(0,4).map((row,i) => `<button class="signal-step ${row.state === 'unknown' ? 'signal-gap' : ''}" data-home-doc="${esc(row.source.docId)}" data-home-anchor="${esc(row.source.anchor)}"><em>0${i+1}</em><span><small>${esc(['Promise','Handoff','Gap','Report'][i])}</small><strong>${esc(row.title)}</strong></span><b>Open</b></button>`).join('')}</div>` : '<p class="signal-empty">Open the case to review what is known and what still needs a source.</p>'}<button class="signal-open" id="signalOpenCase">Open case</button>`;
    board.querySelector('#signalOpenCase').onclick = () => openApp('case');
    board.querySelectorAll('[data-home-doc]').forEach(button => button.onclick = async () => {
      state.sourceDoc = button.dataset.homeDoc;
      state.sourceAnchor = button.dataset.homeAnchor;
      state.sourceFull = null;
      openApp('sources');
      renderApp('sources');
      try { state.sourceFull = await api(`/api/cases/${q(state.caseId)}/documents/${q(state.sourceDoc)}`); renderApp('sources'); }
      catch (err) { toast(err.message); }
    });
  }
  window.liveDesk = { render(id, windowElement) {
    if (!['files', 'case', 'sources', 'notes', 'tasks'].includes(id)) return false;
    windowElement.querySelector('.window-body').innerHTML = ({ files: filesHTML, case: caseHTML, sources: sourcesHTML, notes: notesHTML, tasks: tasksHTML })[id]();
    if (id === 'notes' || id === 'tasks') bindApp(id, windowElement);
    if (id === 'sources' && state.sourceAnchor) windowElement.querySelector('.source-target')?.scrollIntoView({ block: 'center' });
    windowElement.querySelector('#deskCasePicker')?.addEventListener('change', e => { localStorage.setItem('fd-desk-selected', JSON.stringify(e.target.value)); choose(e.target.value); });
    windowElement.querySelectorAll('[data-case]').forEach(b => b.onclick = () => { localStorage.setItem('fd-desk-selected', JSON.stringify(b.dataset.case)); choose(b.dataset.case); openApp('case'); });
    windowElement.querySelectorAll('[data-doc]').forEach(b => b.onclick = async () => { state.sourceDoc = b.dataset.doc; state.sourceAnchor = null; state.sourceFull = null; renderApp('sources'); try { state.sourceFull = await api(`/api/cases/${q(state.caseId)}/documents/${q(state.sourceDoc)}`); renderApp('sources'); } catch (err) { toast(err.message); } });
    windowElement.querySelectorAll('[data-proof-doc]').forEach(b => b.onclick = async () => { state.sourceDoc = b.dataset.proofDoc; state.sourceAnchor = b.dataset.proofAnchor; state.sourceFull = null; openApp('sources'); renderApp('sources'); try { state.sourceFull = await api(`/api/cases/${q(state.caseId)}/documents/${q(state.sourceDoc)}`); renderApp('sources'); } catch (err) { toast(err.message); } });
    windowElement.querySelectorAll('[data-real]').forEach(b => b.onclick = () => { const action = b.dataset.real; if (action === 'investigate') openLink(link()); else if (action === 'replay') openLink(reviewLink()); else if (action === 'create') openLink('/app?new=1'); else if (action === 'add-challenge') { const value = state.caseDetail?.proof_map?.challenge?.next; if (value && !state.tasks.some(t => t.text === value)) { state.tasks.push({ text: value, done: false }); core.persist(); } openApp('tasks'); renderApp('tasks'); toast('Saved privately in this browser'); } else if (action === 'retry') { state.loadError = null; state.cases = null; renderApp('case'); renderApp('files'); refresh(); } else if (action === 'retry-detail') choose(state.caseId); else openApp(action); });
    return true;
  } };
  openApp(window.requestedDeskApp || 'files');
  refresh();
})();
