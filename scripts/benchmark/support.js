const { verifyClaims } = require('../../src/agent/citations');

function score(item, locker, result) {
  const check = verifyClaims(locker, structuredClone(result.draft.claims));
  const refs = new Set();
  const add = (cs) => (cs || []).forEach((c) => refs.add(`${c.doc_id} ${c.anchor}`));
  (result.findings || []).forEach((f) => add(f.citations));
  (result.diagnosis.hypotheses || []).forEach((h) => { add(h.supporting); add(h.contradicting); });
  (result.strategy.proof_plan || []).forEach((p) => add(p.evidence));
  result.draft.claims.forEach((c) => add(c.citations));
  const amount = Number(result.strategy.refund_amount);
  const text = JSON.stringify({ diagnosis: result.diagnosis, strategy: result.strategy, draft: result.draft });
  return {
    // These are mechanical checks, NOT a semantic truth score or win probability.
    strategy_matches: item.rubric.decisions === null ? null : item.rubric.decisions.includes(result.strategy.decision),
    refund_matches: item.rubric.refund === null ? null : amount === item.rubric.refund,
    quotes_matched: check.grounded, claims_checked: check.total,
    removed_claims: result.removed?.length || 0,
    required_refs_found: item.rubric.must_cite.filter((r) => refs.has(r)),
    missing_refs: item.rubric.must_cite.filter((r) => !refs.has(r)),
    forbidden_output: (item.rubric.forbidden || []).filter((s) => text.toLowerCase().includes(s.toLowerCase())),
    semantic_review: 'PENDING', review_questions: item.rubric.review,
    requires_uncertainty_review: Boolean(item.rubric.insufficient),
    uncertainty_decision_matches: item.rubric.insufficient ? result.strategy.decision === 'REQUEST_MORE_EVIDENCE' : null,
  };
}

// CLI-only transport wrapper. It leaves the production client's behavior unchanged.
// Preflight uses an ESTIMATE, not an exact token count. No automatic key fallback.
function meteredFetch(fetchImpl, { maxTokens, maxRequests, maxSeconds = 600, onUsage = () => {} }) {
  for (const [k, n] of Object.entries({ maxTokens, maxRequests, maxSeconds })) {
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be positive`);
  }
  const started = Date.now();
  const state = { requests: 0, prompt: 0, completion: 0, cached: 0, unaccounted_estimate: 0, short_limit_retries: 0, limits: {} };
  const consumed = () => state.prompt + state.completion + state.unaccounted_estimate;
  const stop = (message) => Object.assign(new Error(message), { code: 'BENCHMARK_BUDGET', status: 429 });
  const wrapped = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.origin !== 'https://api.groq.com' || parsed.pathname !== '/openai/v1/chat/completions') {
      throw new Error('Benchmark transport permits Groq chat only; no PayPal calls.');
    }
    const body = JSON.parse(init.body);
    const estimate = Math.ceil(Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools, response_format: body.response_format }), 'utf8') / 3)
      + (body.max_completion_tokens || 1000);
    const remainingMs = maxSeconds * 1000 - (Date.now() - started);
    if (state.requests >= maxRequests || consumed() + estimate > maxTokens || remainingMs <= 0) {
      throw stop(`Benchmark stopped before request ${state.requests + 1}: local request/token/time budget would be exceeded.`);
    }
    state.requests++;
    state.unaccounted_estimate += estimate;
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(30000, remainingMs)));
    const res = await fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    state.limits = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-ratelimit-') || k === 'retry-after'));
    // Read a clone; the Groq client still receives its original response body.
    const data = await res.clone().json().catch(() => null);
    if (data?.usage && Number.isFinite(data.usage.prompt_tokens) && Number.isFinite(data.usage.completion_tokens)) {
      state.unaccounted_estimate -= estimate;
      state.prompt += data.usage.prompt_tokens;
      state.completion += data.usage.completion_tokens;
      state.cached += data.usage.prompt_tokens_details?.cached_tokens || 0;
    } else if ([401, 403, 413, 429].includes(res.status)) {
      // Rejected before generation. Other missing-usage responses retain the reservation.
      state.unaccounted_estimate -= estimate;
    }
    // Let the production client honor a few short minute-limit backoffs. A long
    // or unspecified reset stops immediately; no fallback key is ever selected.
    const retryAfter = Number(res.headers.get('retry-after'));
    const shortRetry = res.status === 429 && retryAfter > 0 && retryAfter <= 30 && state.short_limit_retries < 3;
    if (shortRetry) state.short_limit_retries++;
    onUsage(structuredClone(state));
    if ((res.status === 429 && !shortRetry) || res.status >= 500) {
      throw stop(`Provider returned HTTP ${res.status}; saved partial results. No key was switched.`);
    }
    return res;
  };
  return { fetch: wrapped, state };
}
module.exports = { score, meteredFetch };
