const test = require('node:test');
const assert = require('node:assert');
const { freshScenario } = require('../src/cases');
const { buildLocker } = require('../src/evidence/locker');

test('a live dispute with no demo evidence becomes a usable fresh case', () => {
  const dispute = {
    dispute_id: 'PP-R-TEST-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    dispute_channel: 'INTERNAL',
    dispute_life_cycle_stage: 'INQUIRY',
    dispute_amount: { value: '900.00', currency_code: 'USD' },
    disputed_transactions: [{
      seller_transaction_id: 'TX1',
      buyer: { name: 'Jo Client', email: 'jo@example.com' },
      seller: { name: 'Sam Studio' },
      items: [{ item_name: 'Logo design', notes: 'Not what I asked for.' }],
    }],
    messages: [],
  };
  const s = freshScenario(dispute);
  assert.strictEqual(s.title, 'Logo design');
  assert.strictEqual(s.client.email, 'jo@example.com');
  assert.ok(s.freelancer.name);
  const locker = buildLocker(s, { transactions: [] });
  const statement = locker.read('DISPUTE').sections.find((x) => x.anchor === 'ITEM1');
  assert.strictEqual(statement.text, 'Not what I asked for.');
});
