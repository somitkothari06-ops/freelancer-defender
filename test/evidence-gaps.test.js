const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtures, modelInput } = require('../scripts/benchmark/fixtures');
const { buildLocker } = require('../src/evidence/locker');
const { hasFreelancerEvidence, evidenceOnlyResult } = require('../src/agent/evidence-gaps');
const { buildPackage } = require('../src/agent/package');
const { runDefender } = require('../src/agent/defender');
const groq = require('../src/ai/groq');

test('an allegation without freelancer records pauses without any AI calls or financial actions', async () => {
  const scenario = modelInput(fixtures.find((f) => f.id === 'unauthorized-no-proof'));
  const locker = buildLocker(scenario, { transactions: [] });
  const events = [];
  // No API key is needed: the deterministic branch must return before Groq is called.
  const result = await runDefender({ scenario, locker, sources: {} }, (type, payload) => events.push({ type, payload }));
  assert.equal(result.strategy.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(result.usage.calls, 0);
  assert.equal(result.strategy.refund_amount, '0.00');
  assert.equal(result.package.needsEvidence, true);
  assert.deepEqual(result.package.actions, []);
  assert.deepEqual(result.package._files, []);
  assert.equal(result.package.clientMessage, '');
  assert.ok(result.package.evidenceRequests.some((q) => /authorized/.test(q.question)));
  assert.equal(events.at(-1).type, 'result');
});

test('payment history and empty uploads do not establish fulfillment or authorization', () => {
  const scenario = modelInput(fixtures.find((f) => f.id === 'unauthorized-no-proof'));
  scenario.documents = [{ id: 'EMPTY', sections: [{ text: '  ' }] }];
  const locker = buildLocker(scenario, { transactions: [] });
  locker.docs.set('PAYPAL-TXN', { id: 'PAYPAL-TXN', sections: [{ text: 'A payment exists.' }] });
  assert.equal(hasFreelancerEvidence(locker), false);
  locker.docs.set('AGREEMENT', { id: 'AGREEMENT', sections: [{ text: 'Signed service agreement.' }] });
  assert.equal(hasFreelancerEvidence(locker), true);
});

test('a missing-evidence strategy cannot generate a refund, PDF or client message', () => {
  const scenario = modelInput(fixtures[0]);
  const locker = buildLocker(scenario, { transactions: [] });
  const strategy = { decision: 'REQUEST_MORE_EVIDENCE', refund_amount: '600.00', evidence_requests: [] };
  const pkg = buildPackage({ scenario, locker, draft: { client_message: 'Already refunded.' }, strategy });
  assert.deepEqual(pkg.actions, []);
  assert.deepEqual(pkg._files, []);
  assert.equal(pkg.clientMessage, '');
  assert.ok(pkg.evidenceRequests.length > 0);
});

test('an AI-requested evidence pause skips drafting and still returns actionable questions', async () => {
  const scenario = modelInput(fixtures.find((f) => f.id === 'ambiguous-approval'));
  const locker = buildLocker(scenario, { transactions: [] });
  const defaults = evidenceOnlyResult(scenario);
  const called = [];
  const original = { chat: groq.chat, chatJSON: groq.chatJSON };
  groq.chat = async () => ({ message: { tool_calls: [{ id: 'finish', function: { name: 'finish_investigation', arguments: '{"summary":"Approval remains unproven."}' } }] } });
  groq.chatJSON = async ({ name }) => {
    called.push(name);
    const outputs = { read_complaint: defaults.read, findings: { findings: [], summary: 'Approval is unknown.' }, diagnosis: defaults.diagnosis, strategy: defaults.strategy };
    assert.ok(outputs[name], `Unexpected AI stage ${name}`);
    return { data: structuredClone(outputs[name]) };
  };
  try {
    const result = await runDefender({ scenario, locker, sources: {} }, () => {});
    assert.equal(result.package.needsEvidence, true);
    assert.deepEqual(result.package.actions, []);
    assert.ok(!called.includes('draft'));
    assert.ok(result.package.evidenceRequests.length > 0);
  } finally { Object.assign(groq, original); }
});

test('legacy successful replay strategies still generate the same action kinds', () => {
  const fs = require('node:fs');
  const { scenarios } = require('../src/cases');
  for (const scenario of scenarios) {
    const replay = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../data/replays', `${scenario.dispute.dispute_id}.json`)));
    const old = replay.events.find((e) => e.type === 'result').payload;
    const locker = buildLocker(scenario, { transactions: scenario.paypal_transactions, transactionsSource: 'test' });
    const pkg = buildPackage({ scenario, locker, draft: old.draft, strategy: old.strategy });
    assert.deepEqual(pkg.actions.map((a) => a.kind), old.package.actions.map((a) => a.kind));
  }
});
