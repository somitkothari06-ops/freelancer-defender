const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
const hr = require('../src/handoff-register');

function lockerWith(...sections) {
  const map = new Map();
  for (const [docId, anchor] of sections) {
    if (!map.has(docId)) map.set(docId, new Set());
    map.get(docId).add(anchor);
  }
  return {
    section(docId, anchor) {
      return map.has(docId) && map.get(docId).has(anchor) ? { docId, anchor, text: 'source text' } : null;
    },
  };
}

const L = lockerWith(['CONTRACT', 'S1'], ['LOG', 'L1']);

test('missing owner is rejected', () => {
  assert.throws(() => hr.list('case-1', ''), /owner/i);
  assert.throws(() => hr.add('case-1', '', { deliverable: 'x', events: [] }, L), /owner/i);
  assert.throws(() => hr.remove('case-1', null, 'x'), /owner/i);
});

test('invalid case id is rejected', () => {
  assert.throws(() => hr.list('bad case', 'owner'), /case/i);
  assert.throws(() => hr.add('../x', 'owner', { deliverable: 'x', events: [] }, L), /case/i);
});

test('invalid source is rejected', () => {
  assert.throws(() => hr.add('case-1', 'owner', {
    deliverable: 'Logo',
    events: [{ type: 'sent', date: '2026-01-01', source: { docId: 'NOPE', anchor: 'X' } }],
  }, L), /source/i);
});

test('valid add/list/remove round trip', () => {
  const item = hr.add('case-2', 'owner', {
    deliverable: 'Master ZIP',
    version: 'v1',
    events: [
      { type: 'promised', date: '2026-01-01', note: 'agreed', source: { docId: 'CONTRACT', anchor: 'S1' } },
      { type: 'sent', date: '2026-01-02', source: { docId: 'LOG', anchor: 'L1' } },
    ],
  }, L);
  assert.ok(item.id);
  assert.equal(item.deliverable, 'Master ZIP');
  assert.equal(item.version, 'v1');
  assert.equal(item.events.length, 2);
  assert.equal(item.status, 'open');

  const listed = hr.list('case-2', 'owner');
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].id, item.id);

  assert.equal(hr.remove('case-2', 'owner', item.id), true);
  assert.equal(hr.list('case-2', 'owner').items.length, 0);
  assert.equal(hr.remove('case-2', 'owner', item.id), false);
});

test('owner isolation', () => {
  const a = hr.add('case-3', 'alice', {
    deliverable: 'File',
    events: [{ type: 'promised', date: '2026-01-01', source: { docId: 'CONTRACT', anchor: 'S1' } }],
  }, L);
  assert.equal(hr.list('case-3', 'bob').items.length, 0);
  assert.equal(hr.remove('case-3', 'bob', a.id), false);
  assert.equal(hr.list('case-3', 'alice').items.length, 1);
});

test('conservative language: no delivered/verified claims', () => {
  const item = hr.add('case-4', 'owner', {
    deliverable: 'ZIP',
    events: [
      { type: 'sent', date: '2026-01-01', source: { docId: 'LOG', anchor: 'L1' } },
      { type: 'access_recorded', date: '2026-01-02', source: { docId: 'LOG', anchor: 'L1' } },
    ],
  }, L);
  assert.equal(item.status, 'review_needed');
  assert.equal(item.reconciliationStatus, 'review_needed');
  const serialized = JSON.stringify(item).toLowerCase();
  assert.ok(!serialized.includes('delivered'));
  assert.ok(!serialized.includes('verified'));
  assert.ok(!serialized.includes('received'));
});

test('invalid item fields rejected', () => {
  assert.throws(() => hr.add('case-5', 'owner', null, L), /invalid/i);
  assert.throws(() => hr.add('case-5', 'owner', { events: [] }, L), /deliverable/i);
  assert.throws(() => hr.add('case-5', 'owner', { deliverable: 'x', events: 'nope' }, L), /list/i);
  assert.throws(() => hr.add('case-5', 'owner', { deliverable: 'x', events: [{ type: 'nope', date: '2026-01-01', source: { docId: 'CONTRACT', anchor: 'S1' } }] }, L), /type/i);
  assert.throws(() => hr.add('case-5', 'owner', { deliverable: 'x', events: [{ type: 'sent', date: 'not-a-date', source: { docId: 'CONTRACT', anchor: 'S1' } }] }, L), /date/i);
  assert.throws(() => hr.add('case-5', 'owner', { deliverable: 'x', events: [{ type: 'sent', date: '2026-01-01' }] }, L), /source/i);
});

test('max events enforced', () => {
  const events = Array.from({ length: 31 }, (_, i) => ({ type: 'promised', date: '2026-01-01', source: { docId: 'CONTRACT', anchor: 'S1' } }));
  assert.throws(() => hr.add('case-6', 'owner', { deliverable: 'x', events }, L), /too many events/i);
});

test('a later handoff event keeps its source and owner boundary', () => {
  const item = hr.add('case-7', 'alice', { deliverable: 'Print masters', version: 'v2' }, L);
  const sent = { type: 'sent', date: '2026-01-03', source: { docId: 'LOG', anchor: 'L1' } };
  assert.equal(hr.addEvent('case-7', 'bob', item.id, sent, L), null);
  assert.throws(() => hr.addEvent('case-7', 'alice', item.id, { ...sent, source: { docId: 'LOG', anchor: 'NOPE' } }, L), /source/i);
  const updated = hr.addEvent('case-7', 'alice', item.id, sent, L);
  assert.equal(updated.events.length, 1);
  assert.deepEqual(updated.events[0].source.docId, 'LOG');
  assert.equal(hr.list('case-7', 'alice').items[0].events.length, 1);
  const eventId = updated.events[0].id;
  assert.equal(hr.removeEvent('case-7', 'bob', item.id, eventId), false);
  assert.equal(hr.removeEvent('case-7', 'alice', item.id, eventId), true);
  assert.equal(hr.list('case-7', 'alice').items[0].events.length, 0);
  assert.equal(hr.removeEvent('case-7', 'alice', item.id, eventId), false);
});

test('calendar-invalid dates are rejected', () => {
  assert.throws(() => hr.add('case-8', 'owner', {
    deliverable: 'File',
    events: [{ type: 'sent', date: '2026-02-30', source: { docId: 'LOG', anchor: 'L1' } }],
  }, L), /date/i);
});
