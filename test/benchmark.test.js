const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtures, modelInput } = require('../scripts/benchmark/fixtures');
const { score, meteredFetch } = require('../scripts/benchmark/support');
const { baselinePrompt, options } = require('../scripts/benchmark');
const { buildLocker } = require('../src/evidence/locker');

test('fixture answer keys are valid but excluded from model input', () => {
  assert.equal(fixtures.length, 10);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length);
  for (const f of fixtures) {
    const scenario = modelInput(f);
    assert.equal(scenario.rubric, undefined);
    const locker = buildLocker(scenario, { transactions: [] });
    for (const r of f.rubric.must_cite) {
      const [id, anchor] = r.split(' ');
      assert.ok(locker.section(id, anchor), `${f.id}: ${r}`);
    }
    const prompt = baselinePrompt(scenario, locker);
    for (const question of f.rubric.review) assert.ok(!prompt.includes(question), `${f.id}: rubric leaked`);
    scenario.documents.push({});
    assert.equal(f.scenario.documents.length + 1, scenario.documents.length);
  }
});

test('live execution needs an explicit case; invalid options fail before requests', () => {
  assert.equal(options([]).run, false);
  assert.throws(() => options(['--run']), /explicit --case/);
  assert.throws(() => options(['--case', 'not-found']), /Unknown case/);
  assert.throws(() => options(['--approach', 'oops']), /approach/);
  assert.throws(() => options(['--case']), /incomplete/);
});

test('quote matching is never reported as a semantic correctness score', () => {
  const item = fixtures[0];
  const locker = buildLocker(item.scenario, { transactions: [] });
  const result = { diagnosis: { hypotheses: [] }, strategy: { decision: 'ACCEPT_AND_REFUND', refund_amount: '600', proof_plan: [] },
    draft: { claims: [{ text: 'There was only one capture.', citations: [{ doc_id: 'PAYMENTS', anchor: 'P2', quote: 'retry after timeout created a second capture' }] }] } };
  const s = score(item, locker, result);
  assert.equal(s.quotes_matched, 1);
  assert.equal(s.semantic_review, 'PENDING');
  assert.deepEqual(s.missing_refs, []);
});

const url = 'https://api.groq.com/openai/v1/chat/completions';
const request = { body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], max_completion_tokens: 20 }) };
test('meter counts retry attempts and actual usage, including cached tokens separately', async () => {
  let calls = 0;
  const meter = meteredFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ usage: { prompt_tokens: 30, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 12 } } }),
      { headers: { 'x-ratelimit-limit-tokens': '8000' } });
  }, { maxTokens: 1000, maxRequests: 2 });
  await meter.fetch(url, request);
  await meter.fetch(url, request);
  await assert.rejects(meter.fetch(url, request), /local request\/token\/time budget/);
  assert.equal(calls, 2);
  assert.equal(meter.state.prompt, 60);
  assert.equal(meter.state.completion, 20);
  assert.equal(meter.state.cached, 24);
  assert.equal(meter.state.unaccounted_estimate, 0);
});

test('meter refuses token over-budget requests before using the network', async () => {
  let called = false;
  const meter = meteredFetch(async () => { called = true; }, { maxTokens: 10, maxRequests: 1 });
  await assert.rejects(meter.fetch(url, request), /budget/);
  assert.equal(called, false);
});

test('429 stops immediately and retains rate-limit headers without switching keys', async () => {
  const meter = meteredFetch(async () => new Response('{}', { status: 429, headers: { 'retry-after': '900' } }), { maxTokens: 1000, maxRequests: 5 });
  await assert.rejects(meter.fetch(url, request), (e) => e.code === 'BENCHMARK_BUDGET');
  assert.equal(meter.state.requests, 1);
  assert.equal(meter.state.unaccounted_estimate, 0);
  assert.equal(meter.state.limits['retry-after'], '900');
});

test('missing usage and ambiguous network failures retain conservative reservations', async () => {
  const meter = meteredFetch(async () => new Response('{}'), { maxTokens: 1000, maxRequests: 5 });
  await meter.fetch(url, request);
  assert.ok(meter.state.unaccounted_estimate >= 20);
  const failing = meteredFetch(async () => { throw new Error('network failed'); }, { maxTokens: 1000, maxRequests: 5 });
  await assert.rejects(failing.fetch(url, request), /network failed/);
  assert.ok(failing.state.unaccounted_estimate >= 20);
});

test('short minute-limit backoffs are bounded and still count as attempts', async () => {
  const meter = meteredFetch(async () => new Response('{}', { status: 429, headers: { 'retry-after': '5' } }), { maxTokens: 1000, maxRequests: 10 });
  for (let i = 0; i < 3; i++) assert.equal((await meter.fetch(url, request)).status, 429);
  await assert.rejects(meter.fetch(url, request), /Provider returned HTTP 429/);
  assert.equal(meter.state.requests, 4);
  assert.equal(meter.state.short_limit_retries, 3);
});

test('benchmark transport cannot touch PayPal or accept invalid budgets', async () => {
  assert.throws(() => meteredFetch(fetch, { maxTokens: NaN, maxRequests: 1 }), /positive/);
  const meter = meteredFetch(async () => { throw new Error('should not be called'); }, { maxTokens: 1000, maxRequests: 1 });
  await assert.rejects(meter.fetch('https://api-m.sandbox.paypal.com/v1/customer/disputes', request), /Groq chat only/);
});
