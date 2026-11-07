const test = require('node:test');
const assert = require('node:assert/strict');
const { allClaimsReviewed } = require('../src/claim-review');

test('live submission requires one review decision for each claim', () => {
  const claims = [{ text: 'first' }, { text: 'second' }, { text: 'third' }];
  assert.equal(allClaimsReviewed(claims, [0, 1, 2]), true);
  assert.equal(allClaimsReviewed(claims, [2, 0, 1]), true);
  assert.equal(allClaimsReviewed(claims, [0, 1]), false);
  assert.equal(allClaimsReviewed(claims, [0, 1, 1]), false);
  assert.equal(allClaimsReviewed(claims, [0, 1, 3]), false);
  assert.equal(allClaimsReviewed(claims, ['0', 1, 2]), false);
  assert.equal(allClaimsReviewed([], []), false);
});
