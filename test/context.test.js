const test = require('node:test');
const assert = require('node:assert/strict');
const { scenarios } = require('../src/cases');
const { buildLocker } = require('../src/evidence/locker');
const { directConcernRefs } = require('../src/agent/context');

test('Halden diagnosis context includes the unread client report', () => {
  const scenario = scenarios.find((item) => item.id === 'halden-brand');
  const refs = directConcernRefs(buildLocker(scenario, { transactions: [] }));
  assert.ok(refs.some((ref) => ref.doc_id === 'CONTACT-FORM' && ref.anchor === 'F1'));
});
