const test = require('node:test');
const assert = require('node:assert/strict');
const { unsupportedNonreceipt, safeText, safeDiagnosis, safeDraft } = require('../src/agent/claim-guard');

test('receipt guard distinguishes service activity from recipient receipt', () => {
  const examples = [
    ['The client never obtained the master files.', true],
    ['The client never retrieved the master vector files.', true],
    ['The buyer did not receive the package.', true],
    ['The files were not delivered to the client.', true],
    ['Zero master-package download events were recorded in this service.', false],
    ['The client reports they never received the files.', false],
    ['The client said they did not receive the package.', false],
    ['The transfer log reports zero events; the client never received the files.', true],
    ['The client never received the files, and the transfer log reports zero events.', true],
    ['Another delivery route remains possible.', false],
  ];
  for (const [sentence, expected] of examples) assert.equal(unsupportedNonreceipt(sentence), expected, sentence);
});

test('unsafe diagnosis is held while attributed concerns remain attributed', () => {
  const input = { real_complaint: { summary: 'The client never obtained the master files.', confidence: 80 },
    client_concerns: [{ concern: 'The client reports they never received the files.' }] };
  const { diagnosis, blocked } = safeDiagnosis(input);
  assert.equal(blocked, true);
  assert.match(diagnosis.real_complaint.summary, /do not establish whether/);
  assert.equal(diagnosis.client_concerns[0].concern, input.client_concerns[0].concern);
  assert.equal(input.real_complaint.summary, 'The client never obtained the master files.');
});

test('unsafe draft assertion cannot enter the response or client message', () => {
  const draft = { response_title: 'Review', claims: [
    { text: 'The client never received the files.', citations: [{ doc_id: 'LOG', anchor: 'L5', quote: '0 downloads' }] },
    { text: 'No master-package download events were recorded in this service.', citations: [{ doc_id: 'LOG', anchor: 'L5', quote: '0 downloads' }] },
  ], client_message: 'You never received the files. We can check another route.' };
  const result = safeDraft(draft);
  assert.equal(result.draft.claims.length, 1);
  assert.equal(result.removed.length, 1);
  assert.match(result.draft.client_message, /do not establish whether/);
  assert.equal(safeText('The client reports they never received the files.'), 'The client reports they never received the files.');
});

test('an unsupported diagnosis pauses before a response or PayPal package is drafted', async () => {
  const { fixtures, modelInput } = require('../scripts/benchmark/fixtures');
  const { buildLocker } = require('../src/evidence/locker');
  const { evidenceOnlyResult } = require('../src/agent/evidence-gaps');
  const { runDefender } = require('../src/agent/defender');
  const groq = require('../src/ai/groq');
  const scenario = modelInput(fixtures.find((f) => f.id === 'ambiguous-approval'));
  const locker = buildLocker(scenario, { transactions: [] });
  const defaults = evidenceOnlyResult(scenario);
  const stages = [];
  const original = { chat: groq.chat, chatJSON: groq.chatJSON };
  groq.chat = async () => ({ message: { tool_calls: [{ id: 'finish', function: { name: 'finish_investigation', arguments: '{"summary":"Evidence reviewed."}' } }] } });
  groq.chatJSON = async ({ name }) => {
    stages.push(name);
    const outputs = {
      read_complaint: defaults.read,
      findings: { findings: [], summary: 'The log records no event.' },
      diagnosis: { ...defaults.diagnosis, real_complaint: { summary: 'The client never obtained the files.', what_the_client_actually_needs: 'Receipt confirmation.', confidence: 90 } },
      strategy: { decision: 'CONTEST', rationale: 'Contest the claim.', proof_plan: [], resolution_action: 'none', refund_amount: '0.00', evidence_requests: [] },
    };
    assert.ok(outputs[name], `Unexpected AI stage: ${name}`);
    return { data: structuredClone(outputs[name]) };
  };
  try {
    const result = await runDefender({ scenario, locker, sources: {} }, () => {});
    assert.equal(result.strategy.decision, 'REQUEST_MORE_EVIDENCE');
    assert.equal(result.package.needsEvidence, true);
    assert.deepEqual(result.package.actions, []);
    assert.ok(!stages.includes('draft'));
    assert.match(result.diagnosis.real_complaint.summary, /do not establish whether/);
  } finally { Object.assign(groq, original); }
});
