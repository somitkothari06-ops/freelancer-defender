// The Freelancer Defender agent: runs one dispute through every reasoning stage
// and reports each step as an event, so the dashboard can draw the reasoning trail live.
//
//   1. intake       pull the dispute + the client's payment history from PayPal
//   2. read         what does the client literally claim? what's vague?
//   3. investigate  tool-using loop: open documents, search, record findings
//   4. diagnose     competing hypotheses -> the real complaint
//   5. strategy     contest / contest + fix / partial refund / accept, and a proof plan
//   6. draft        response where every claim carries exact-quote citations
//   7. verify       deterministic citation check (+ one repair pass if needed)
//   8. package      build the PayPal provide-evidence request
const groq = require('../ai/groq');
const P = require('./prompts');
const playbookFor = require('./playbook');
const { verifyClaims } = require('./citations');
const { buildPackage } = require('./package');
const { statementParts } = require('../evidence/locker');

const MAX_INVESTIGATION_TURNS = 8;

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

/**
 * @param {object}   input
 * @param {object}   input.scenario   freelancer, client, dispute, documents
 * @param {Locker}   input.locker     evidence locker (already includes PayPal docs)
 * @param {object}   input.sources    where the PayPal data came from (live API or seeded)
 * @param {function} emit             emit(type, payload) - streamed to the browser
 */
async function runDefender({ scenario, locker, sources }, emit) {
  const { dispute, freelancer, client } = scenario;
  const playbook = playbookFor(dispute.reason);
  const usage = { prompt: 0, completion: 0, calls: 0 };
  const opts = {
    onWait: (ms, reason) => emit('pacing', { ms, reason }),
  };
  const track = (u) => {
    if (!u) return;
    usage.prompt += u.prompt_tokens || 0;
    usage.completion += u.completion_tokens || 0;
    usage.calls += 1;
  };
  const sys = { role: 'system', content: P.SYSTEM };

  // Only keep citations that point at something real. (The final draft gets a stricter, quote-level check.)
  const realRefs = (refs = []) => refs.map((c) => locker.resolve(c.doc_id, c.anchor)).filter(Boolean);

  // Exact text for a set of doc/anchor pairs, formatted for a prompt.
  const sectionText = (refs) => {
    const seen = new Set();
    return refs
      .filter((c) => {
        const k = `${c.doc_id} ${c.anchor}`;
        if (seen.has(k) || !locker.section(c.doc_id, c.anchor)) return false;
        seen.add(k);
        return true;
      })
      .map((c) => {
        const s = locker.section(c.doc_id, c.anchor);
        return `doc_id=${c.doc_id} anchor=${c.anchor} | ${s.heading}: ${s.text}`;
      })
      .join('\n');
  };

  // ---- 1. Intake --------------------------------------------------------------
  emit('stage', { stage: 'intake', status: 'start' });
  const statement = statementParts(dispute).map((p) => p.text).join('\n');
  emit('stage', {
    stage: 'intake',
    status: 'done',
    data: {
      dispute_id: dispute.dispute_id,
      reason: dispute.reason,
      amount: dispute.dispute_amount,
      statement,
      sources,
      documents: locker.index(),
    },
  });

  // ---- 2. Read the complaint ----------------------------------------------------
  emit('stage', { stage: 'read', status: 'start' });
  const readRes = await groq.chatJSON(
    {
      name: 'read_complaint',
      schema: P.readSchema,
      messages: [sys, { role: 'user', content: P.readPrompt({ dispute, freelancer, client, playbook, statement }) }],
      maxTokens: 2500,
      reasoningEffort: 'medium',
    },
    opts
  );
  track(readRes.usage);
  const read = readRes.data;
  emit('stage', { stage: 'read', status: 'done', data: read, thinking: clip(readRes.reasoning, 600) });

  // ---- 3. Investigate (tool loop) -----------------------------------------------
  emit('stage', { stage: 'investigate', status: 'start' });
  const findings = [];
  const opened = new Set();
  const messages = [sys, { role: 'user', content: P.investigatePrompt({ read, index: locker.index() }) }];
  let finished = null;

  for (let turn = 0; turn < MAX_INVESTIGATION_TURNS && !finished; turn++) {
    const { message, usage: u } = await groq.chat(
      {
        messages,
        tools: P.investigateTools,
        tool_choice: 'auto',
        max_completion_tokens: 2000,
        reasoning_effort: 'medium',
      },
      opts
    );
    track(u);
    if (message.reasoning) emit('thinking', { stage: 'investigate', text: clip(message.reasoning, 500) });

    const calls = message.tool_calls || [];
    messages.push({ role: 'assistant', content: message.content || '', ...(calls.length ? { tool_calls: calls } : {}) });

    if (calls.length === 0) {
      messages.push({
        role: 'user',
        content: 'Continue the investigation using the tools. Call finish_investigation when you are done.',
      });
      continue;
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* leave args empty; the tool reports the problem back to the model */
      }
      const result = runTool(call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.forModel) });
    }
  }

  // Executes one tool call and tells the dashboard about it.
  function runTool(name, args) {
    if (name === 'read_document') {
      const doc = locker.read(args.doc_id);
      if (!doc) return { forModel: { error: `No document ${args.doc_id}. Use a doc_id from the index.` } };
      opened.add(doc.doc_id);
      emit('tool', { name, doc_id: doc.doc_id, title: doc.title, source: doc.source, sections: doc.sections.map((s) => s.anchor) });
      return { forModel: doc };
    }
    if (name === 'search_evidence') {
      const hits = locker.search(String(args.query || ''));
      emit('tool', { name, query: args.query, hits: hits.map((h) => ({ doc_id: h.doc_id, anchor: h.anchor, heading: h.heading })) });
      return { forModel: hits.length ? hits.map(({ score, ...h }) => h) : 'No matches. Try different words or open a document.' };
    }
    if (name === 'record_finding') {
      const citations = realRefs(args.citations);
      const finding = { finding: String(args.finding || ''), significance: String(args.significance || ''), citations };
      if (!finding.finding) return { forModel: { error: 'finding is required' } };
      findings.push(finding);
      emit('finding', { ...finding, dropped: (args.citations || []).length - citations.length });
      return {
        forModel: citations.length
          ? { recorded: true, total_findings: findings.length }
          : { recorded: true, warning: 'None of those citations exist. Cite doc_id + anchor exactly as shown in the documents.' },
      };
    }
    if (name === 'finish_investigation') {
      finished = String(args.summary || '');
      return { forModel: { ok: true } };
    }
    return { forModel: { error: `Unknown tool ${name}` } };
  }

  // Consolidate: the agent writes up every finding from everything it read, so the
  // diagnosis doesn't depend on whether it remembered to call record_finding each time.
  // (The conversation is flattened to plain text so this works without tool definitions.)
  const transcript = messages
    .slice(1)
    .map((m) =>
      m.role === 'tool'
        ? `TOOL RESULT: ${m.content}`
        : m.tool_calls
          ? `AGENT CALLED: ${m.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`).join(', ')}`
          : `${m.role.toUpperCase()}: ${m.content}`
    )
    .join('\n\n');
  const consRes = await groq.chatJSON(
    {
      name: 'findings',
      schema: P.findingsSchema,
      messages: [sys, { role: 'user', content: `${transcript}\n\n${P.consolidatePrompt}` }],
      maxTokens: 3000,
      reasoningEffort: 'low',
    },
    opts
  );
  track(consRes.usage);
  const known = new Set(findings.map((f) => f.citations.map((c) => `${c.doc_id} ${c.anchor}`).sort().join('|')));
  for (const f of consRes.data.findings) {
    const citations = realRefs(f.citations);
    if (!citations.length) continue;
    const sig = citations.map((c) => `${c.doc_id} ${c.anchor}`).sort().join('|');
    if (known.has(sig)) continue; // already shown live
    known.add(sig);
    const finding = { finding: f.finding, significance: f.significance, citations };
    findings.push(finding);
    emit('finding', finding);
  }

  emit('stage', {
    stage: 'investigate',
    status: 'done',
    data: { summary: consRes.data.summary || finished || '', findings: findings.length, opened: [...opened] },
  });

  // ---- 4. Diagnose ------------------------------------------------------------
  emit('stage', { stage: 'diagnose', status: 'start' });
  // The dispute itself and the full agreement are always in view for the later stages:
  // which terms apply is the whole argument, so it can't depend on what got cited earlier.
  const disputeRefs = [...locker.docs.values()]
    .filter((d) => d.id === 'DISPUTE' || d.kind === 'contract')
    .flatMap((d) => d.sections.map((s) => ({ doc_id: d.id, anchor: s.anchor })));
  const findingRefs = findings.flatMap((f) => f.citations);
  const diagRes = await groq.chatJSON(
    {
      name: 'diagnosis',
      schema: P.diagnoseSchema,
      messages: [sys, { role: 'user', content: P.diagnosePrompt({ read, findings, citedText: sectionText([...disputeRefs, ...findingRefs]) }) }],
      maxTokens: 5500,
      reasoningEffort: 'medium',
    },
    opts
  );
  track(diagRes.usage);
  const diagnosis = diagRes.data;
  diagnosis.hypotheses = diagnosis.hypotheses
    .map((h) => ({ ...h, supporting: realRefs(h.supporting), contradicting: realRefs(h.contradicting) }))
    .sort((a, b) => b.likelihood - a.likelihood);
  diagnosis.freelancer_weaknesses = diagnosis.freelancer_weaknesses.map((w) => ({ ...w, citations: realRefs(w.citations) }));
  diagnosis.client_concerns = diagnosis.client_concerns.map((c) => ({ ...c, said_in: realRefs(c.said_in), answered_by: realRefs(c.answered_by) }));
  emit('stage', { stage: 'diagnose', status: 'done', data: diagnosis, thinking: clip(diagRes.reasoning, 800) });

  // ---- 5. Strategy ------------------------------------------------------------
  emit('stage', { stage: 'strategy', status: 'start' });
  const diagRefs = diagnosis.hypotheses.flatMap((h) => [...h.supporting, ...h.contradicting]);
  const weakRefs = diagnosis.freelancer_weaknesses.flatMap((w) => w.citations);
  const concernRefs = diagnosis.client_concerns.flatMap((c) => [...c.said_in, ...c.answered_by]);
  const allRefs = [...disputeRefs, ...findingRefs, ...diagRefs, ...weakRefs, ...concernRefs];
  const citable = sectionText(allRefs);
  const stratRes = await groq.chatJSON(
    {
      name: 'strategy',
      schema: P.strategySchema,
      messages: [sys, { role: 'user', content: P.strategyPrompt({ dispute, read, diagnosis: { ...diagnosis, _citable: citable }, playbook }) }],
      maxTokens: 3000,
      reasoningEffort: 'medium',
    },
    opts
  );
  track(stratRes.usage);
  const strategy = stratRes.data;
  strategy.proof_plan = strategy.proof_plan.map((p) => ({ ...p, evidence: realRefs(p.evidence) }));
  emit('stage', { stage: 'strategy', status: 'done', data: strategy, thinking: clip(stratRes.reasoning, 600) });

  // ---- 6. Draft ---------------------------------------------------------------
  emit('stage', { stage: 'draft', status: 'start' });
  const draftText = sectionText([...allRefs, ...strategy.proof_plan.flatMap((p) => p.evidence)]);
  const draftRes = await groq.chatJSON(
    {
      name: 'draft',
      schema: P.draftSchema,
      messages: [sys, { role: 'user', content: P.draftPrompt({ freelancer, client, strategy, diagnosis, citedText: draftText, playbook }) }],
      maxTokens: 4000,
      reasoningEffort: 'medium',
    },
    opts
  );
  track(draftRes.usage);
  const draft = draftRes.data;
  emit('stage', { stage: 'draft', status: 'done', data: { response_title: draft.response_title, claims: draft.claims.length } });

  // ---- 7. Verify every citation ---------------------------------------------------
  emit('stage', { stage: 'verify', status: 'start' });
  let check = verifyClaims(locker, draft.claims);
  let repaired = 0;
  const failed = check.results.filter((r) => !r.grounded);
  if (failed.length) {
    emit('verify_issue', { failed: failed.map((f) => ({ text: f.text, problems: f.citations.filter((c) => !c.ok).map((c) => c.problem) })) });
    const repairRefs = failed.flatMap((f) => f.citations.filter((c) => locker.section(c.doc_id, c.anchor)));
    const repairRes = await groq.chatJSON(
      {
        name: 'repair',
        schema: P.repairSchema,
        messages: [sys, { role: 'user', content: P.repairPrompt({ failed, citedText: sectionText([...repairRefs, ...allRefs]) }) }],
        maxTokens: 2500,
        reasoningEffort: 'low',
      },
      opts
    );
    track(repairRes.usage);
    // Put repaired claims back in their original positions.
    failed.forEach((f, i) => {
      if (repairRes.data.claims[i]) draft.claims[f.index] = repairRes.data.claims[i];
    });
    repaired = failed.length;
    check = verifyClaims(locker, draft.claims);
  }
  // Anything still ungrounded is removed from the response, and shown as removed in the UI.
  const removed = check.results.filter((r) => !r.grounded);
  const claims = check.results.filter((r) => r.grounded);
  emit('stage', {
    stage: 'verify',
    status: 'done',
    data: {
      grounded: claims.length,
      total: check.total,
      repaired,
      removed: removed.map((r) => ({ text: r.text, problems: r.citations.filter((c) => !c.ok).map((c) => c.problem) })),
      citations: check.passedCitations,
    },
  });

  // ---- 8. Package for PayPal ----------------------------------------------------
  const pkg = buildPackage({ scenario, locker, draft: { ...draft, claims }, strategy, diagnosis });
  const result = { read, findings, diagnosis, strategy, draft: { ...draft, claims }, removed, package: pkg, usage };
  emit('stage', { stage: 'package', status: 'done', data: { package: pkg } });
  emit('result', result);
  return result;
}

module.exports = { runDefender };
