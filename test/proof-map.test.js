const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarios } = require('../src/cases');
const { buildLocker } = require('../src/evidence/locker');
const { freshScenario } = require('../src/cases');
const customCases = require('../src/custom-cases');
const { buildProofMap } = require('../src/proof-map');

function validRows(map, locker) {
  assert.ok(map && Array.isArray(map.rows) && map.rows.length > 0);
  for (const row of map.rows) {
    assert.ok(row.source && typeof row.source.docId === 'string' && typeof row.source.anchor === 'string');
    const doc = locker.read(row.source.docId);
    assert.ok(doc, `unknown doc ${row.source.docId}`);
    const section = doc.sections.find((s) => s.anchor === row.source.anchor);
    assert.ok(section, `invalid anchor ${row.source.docId}#${row.source.anchor}`);
    assert.equal(row.source.excerpt, section.text);
  }
  // Challenge source must also be real.
  const cdoc = locker.read(map.challenge.source.docId);
  assert.ok(cdoc, `unknown challenge doc ${map.challenge.source.docId}`);
  assert.ok(cdoc.sections.some((s) => s.anchor === map.challenge.source.anchor), `invalid challenge anchor ${map.challenge.source.docId}#${map.challenge.source.anchor}`);
}

test('Halden keeps the curated map and all source anchors are real', () => {
  const scenario = scenarios.find((s) => s.id === 'halden-brand');
  const caseData = { live: false, scenario, transactions: scenario.paypal_transactions, sources: {} };
  const locker = buildLocker(scenario, { transactions: scenario.paypal_transactions, transactionsSource: 'test' });
  const map = buildProofMap(caseData, locker);
  assert.ok(map);
  assert.equal(map.rows.length, 5);
  validRows(map, locker);
  assert.ok(map.rows.some((r) => r.finding.includes('zero master-package downloads')));
});

test('a custom case with no non-PayPal documents still gets a non-empty, source-linked map', () => {
  const custom = customCases.create({ client: 'Acme Co', statement: 'The work was not as described.', work: 'Logo design', amount: 1000 }, '');
  const scenario = { ...custom, paypal_transactions: [], documents: [] };
  const caseData = { live: false, scenario, transactions: [], sources: {} };
  const locker = buildLocker(scenario, { transactions: [], transactionsSource: 'none' });
  const map = buildProofMap(caseData, locker);
  assert.ok(map);
  validRows(map, locker);
  const text = [map.challenge.question, map.challenge.reason, map.challenge.next].join(' ');
  assert.match(text, /agreement/i);
  assert.match(text, /handoff/i);
  // Conservative wording must not claim receipt or verification.
  const findings = map.rows.map((r) => r.finding).join(' ').toLowerCase();
  for (const forbidden of ['received', 'downloaded', 'delivered', 'approved', 'auto-verification', 'verified automatically']) {
    assert.ok(!findings.includes(forbidden), `unexpected claim: ${forbidden}`);
  }
});

test('a custom-shaped case with a contract and messages links to real anchors and uses conservative findings', () => {
  const scenario = {
    id: 'MY-TEST',
    title: 'Test case',
    freelancer: { name: 'You', business: 'You', email: '' },
    client: { name: 'Client', company: 'Client', email: '' },
    dispute: {
      dispute_id: 'MY-TEST',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      dispute_amount: { currency_code: 'USD', value: '500.00' },
      disputed_transactions: [{ items: [{ item_name: 'Work', notes: 'Not what I asked for.' }] }],
      messages: [],
    },
    paypal_transactions: [],
    documents: [
      { id: 'AGREEMENT', title: 'Agreement', kind: 'contract', source: 'Freelancer', summary: 'Agreement.', sections: [{ anchor: '§1', heading: 'Scope', text: 'Scope text here.' }] },
      { id: 'MESSAGES', title: 'Messages', kind: 'messages', source: 'Freelancer', summary: 'Messages.', sections: [{ anchor: 'M1', heading: 'Message', text: 'Message text here.' }] },
    ],
  };
  const caseData = { live: false, scenario, transactions: [], sources: {} };
  const locker = buildLocker(scenario, { transactions: [], transactionsSource: 'none' });
  const map = buildProofMap(caseData, locker);
  assert.ok(map);
  validRows(map, locker);
  const findings = map.rows.map((r) => r.finding).join(' ');
  assert.match(findings, /agreement is in the case file/i);
  assert.match(findings, /Delivery or message record to inspect/);
  assert.match(findings, /this map has not checked them/i);
  assert.match(findings, /client statement is in the case file/i);
});

test('a fresh live case produces a non-null source-linked map', () => {
  const dispute = {
    dispute_id: 'PP-R-FRESH-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    dispute_channel: 'INTERNAL',
    dispute_life_cycle_stage: 'INQUIRY',
    dispute_amount: { value: '900.00', currency_code: 'USD' },
    disputed_transactions: [{ seller_transaction_id: 'TX1', buyer: { name: 'Jo Client', email: 'jo@example.com' }, seller: { name: 'Sam Studio' }, items: [{ item_name: 'Logo design', notes: 'Not what I asked for.' }] }],
    messages: [],
  };
  const scenario = freshScenario(dispute);
  const caseData = { live: true, scenario, transactions: [], sources: {} };
  const locker = buildLocker(scenario, { transactions: [] });
  const map = buildProofMap(caseData, locker);
  assert.ok(map);
  validRows(map, locker);
});

test('no map contains auto-verification language', () => {
  const scenario = scenarios.find((s) => s.id === 'halden-brand');
  const locker = buildLocker(scenario, { transactions: scenario.paypal_transactions, transactionsSource: 'test' });
  const map = buildProofMap({ live: false, scenario, transactions: scenario.paypal_transactions, sources: {} }, locker);
  const serialized = JSON.stringify(map).toLowerCase();
  assert.ok(!serialized.includes('auto-verification'));
  assert.ok(!serialized.includes('verified automatically'));
  assert.ok(!serialized.includes('automatically verified'));
});
