const test = require('node:test');
const assert = require('node:assert');
const { splitDocument } = require('../src/evidence/uploads');

test('contract clauses become § sections, a title above clause 1 stays separate', () => {
  const s = splitDocument('WEBSITE AGREEMENT\n\n1. Parties\nSam and Acme.\n\n3.1 Payment. Client pays $1,800.\n\nSection 5 - Refunds\nNo refunds after launch.', 'contract');
  assert.deepStrictEqual(s.map((x) => x.anchor), ['P1', '§1', '§3.1', '§5']);
  assert.strictEqual(s[1].heading, 'Parties');
  assert.strictEqual(s[2].heading, 'Payment');
  assert.strictEqual(s[3].text, 'No refunds after launch.');
});

test('a sentence starting with a number is not a clause', () => {
  const s = splitDocument('30 days after delivery, support ends.', 'contract');
  assert.strictEqual(s[0].anchor, 'P1');
});

test('logs split one section per line', () => {
  const s = splitDocument('2026-07-01 file.zip downloaded\n\n2026-07-09 link expired', 'log');
  assert.deepStrictEqual(s.map((x) => x.anchor), ['L1', 'L2']);
});

test('long paragraphs are chunked at sentence ends with unique anchors', () => {
  const para = 'This is a sentence about the work. '.repeat(80);
  const s = splitDocument(para, 'messages');
  assert.ok(s.length > 1);
  assert.strictEqual(new Set(s.map((x) => x.anchor)).size, s.length);
  assert.ok(s.every((x) => x.text.length <= 1200));
});
