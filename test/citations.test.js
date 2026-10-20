// Tests for the deterministic parts: the evidence locker and the citation checker.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { scenarios } = require('../src/cases');
const { buildLocker } = require('../src/evidence/locker');
const { checkCitation, verifyClaims } = require('../src/agent/citations');

const hero = scenarios.find((s) => s.id === 'halden-brand');
const locker = buildLocker(hero, { transactions: hero.paypal_transactions, transactionsSource: 'test' });

test('a correct quote passes', () => {
  const r = checkCitation(locker, { doc_id: 'DELIVERY-LOG', anchor: 'L5', quote: 'Halden_Master_Vectors_and_Copyright.zip - 0 downloads' });
  assert.equal(r.ok, true);
});

test('a quote may skip words with "..."', () => {
  const r = checkCitation(locker, { doc_id: 'CONTRACT', anchor: '§7.2', quote: 'Studio will re-issue ... at no charge' });
  assert.equal(r.ok, true);
});

test('quotes are compared ignoring case and curly quotes', () => {
  const r = checkCitation(locker, { doc_id: 'EMAILS', anchor: 'E4', quote: 'APPROVED, LET’S MAKE IT OFFICIAL' });
  assert.equal(r.ok, true);
});

test('an invented quote fails', () => {
  const r = checkCitation(locker, { doc_id: 'DELIVERY-LOG', anchor: 'L5', quote: 'downloaded 3 times by the client' });
  assert.equal(r.ok, false);
});

test('a quote from the wrong section fails', () => {
  const r = checkCitation(locker, { doc_id: 'CONTRACT', anchor: '§8', quote: 'Studio will re-issue the Final Asset Package' });
  assert.equal(r.ok, false);
});

test('misspelled references are repaired, but the quote is still checked', () => {
  const c = { doc_id: 'CONTRACT_7_2', anchor: '', quote: 'Studio will re-issue the Final Asset Package' };
  assert.equal(checkCitation(locker, c).ok, true);
  assert.equal(c.doc_id, 'CONTRACT');
  assert.equal(c.anchor, '§7.2');
  const bad = { doc_id: 'CONTRACT_7_2', anchor: '', quote: 'Studio refunds everything' };
  assert.equal(checkCitation(locker, bad).ok, false);
});

test('PayPal records are citable documents', () => {
  const r = checkCitation(locker, { doc_id: 'PAYPAL-TXN', anchor: '7HL40291KX5523310', quote: 'paid by daniel@haldencoffee.com' });
  assert.equal(r.ok, true);
});

test('verifyClaims requires every claim to have a passing citation', () => {
  const v = verifyClaims(locker, [
    { text: 'ok', citations: [{ doc_id: 'EMAILS', anchor: 'E7', quote: 'downloading now' }] },
    { text: 'no citations', citations: [] },
    { text: 'one bad', citations: [{ doc_id: 'EMAILS', anchor: 'E7', quote: 'downloading now' }, { doc_id: 'EMAILS', anchor: 'E7', quote: 'I hate it' }] },
  ]);
  assert.equal(v.grounded, 1);
  assert.equal(v.total, 3);
});

test('every scenario answer key points at real sections', () => {
  for (const s of scenarios) {
    const l = buildLocker(s, { transactions: s.paypal_transactions, transactionsSource: 'test' });
    for (const ref of s.answer_key.must_find) {
      const [doc, anchor] = ref.split(' ');
      assert.ok(l.section(doc, anchor), `${s.id}: ${ref} missing`);
    }
  }
});

test('quotes may include the section heading and typographic hyphens', () => {
  const r = checkCitation(locker, { doc_id: 'CONTRACT', anchor: '§3.2', quote: 'Final Asset Package: On completion ... a print‑ready PDF brand guide' });
  assert.equal(r.ok, true);
});
