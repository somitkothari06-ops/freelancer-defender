// Small server-side register of a freelancer's handoff/delivery events for one case.
//
// This is a *record* of observations and claims, not proof of delivery. Every event must
// point at a real source section in the evidence locker. Nothing here ever converts
// "sent"/"access recorded" into "received"/"accepted": those are different claims that
// require their own records. The reconciliation status below is derived from event TYPES
// only and stays conservative ("open" / "review_needed").
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dataDir() { return process.env.DATA_DIR || path.join(__dirname, '..', 'data'); }
function rootDir() { return path.join(dataDir(), 'handoffs'); }

const MAX_ITEMS = 50;
const MAX_EVENTS = 30;
const MAX_NAME = 120;
const MAX_VERSION = 60;
const MAX_NOTE = 500;

const ALLOWED_TYPES = new Set([
  'promised',
  'sent',
  'access_recorded',
  'client_reported',
  'reissued',
  'accepted',
]);

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function hashOwner(owner) {
  return crypto.createHash('sha256').update(String(owner), 'utf8').digest('hex');
}

function safeCaseId(caseId) {
  return typeof caseId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(caseId.trim());
}

function clean(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validOwner(owner) {
  return typeof owner === "string" && owner.trim().length > 0;
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}

function normalizeDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function caseFile(caseId, owner) {
  const dir = path.join(rootDir(), hashOwner(owner.trim()));
  return path.join(dir, `${caseId.trim()}.json`);
}

function readItems(caseId, owner) {
  const file = caseFile(caseId, owner);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    throw new Error('Invalid handoff register format.');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function atomicWrite(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function writeItems(caseId, owner, items) {
  atomicWrite(caseFile(caseId, owner), { items });
}

function sourceFromEvent(ev) {
  const src = ev && (ev.source || ev.sourceRef || ev.ref);
  if (src && typeof src === 'object') {
    const docId = src.docId || src.doc_id || src.documentId || src.document_id || ev.docId || ev.doc_id || ev.sourceDocId || ev.source_doc_id;
    const anchor = src.anchor || src.section || src.anchorId || src.anchor_id || ev.anchor || ev.sourceAnchor || ev.source_anchor;
    return { docId, anchor };
  }
  const docId = ev && (ev.docId || ev.doc_id || ev.sourceDocId || ev.source_doc_id || ev.documentId);
  const anchor = ev && (ev.anchor || ev.sourceAnchor || ev.source_anchor || ev.section);
  return { docId, anchor };
}

function validateEvent(ev, locker, index) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw bad(`Event ${index + 1} must be an object.`);
  const type = ev.type || ev.eventType || ev.kind || ev.status;
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type.trim())) {
    throw bad(`Event ${index + 1} has an invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}.`);
  }
  const date = ev.date || ev.occurredAt || ev.occurred_at || ev.timestamp || ev.time;
  if (!validDate(date)) throw bad(`Event ${index + 1} requires a valid date.`);
  const noteRaw = ev.note ?? ev.notes ?? ev.description ?? ev.comment ?? ev.details ?? '';
  if (typeof noteRaw !== 'string') throw bad(`Event ${index + 1} note must be text.`);
  const trimmedNote = noteRaw.replace(/\s+/g, ' ').trim();
  if (trimmedNote.length > MAX_NOTE) throw bad(`Event ${index + 1} note is too long.`);
  const note = trimmedNote.slice(0, MAX_NOTE);

  const { docId, anchor } = sourceFromEvent(ev);
  if (typeof docId !== 'string' || !docId.trim()) throw bad(`Event ${index + 1} requires a source docId.`);
  if (typeof anchor !== 'string' || !anchor.trim()) throw bad(`Event ${index + 1} requires a source anchor.`);
  const d = String(docId).trim();
  const a = String(anchor).trim();
  if (typeof locker?.section !== 'function' || !locker.section(d, a)) {
    throw bad(`Event ${index + 1} source is not valid for this case (docId/anchor not found).`);
  }
  return {
    id: `evt${crypto.randomBytes(6).toString('hex')}`,
    type: type.trim(),
    date: normalizeDate(date),
    note,
    source: { docId: d, anchor: a, doc_id: d },
  };
}

function reconciliationStatus(events) {
  const types = new Set((events || []).map((e) => e.type));
  if (events.length === 0) return 'open';
  if (types.has('client_reported')) return 'review_needed';
  if (types.has('reissued')) return 'review_needed';
  if (types.has('accepted')) return 'review_needed';
  if (types.has('sent') && types.has('access_recorded')) return 'review_needed';
  return 'open';
}

function normalizeItem(input, events, now) {
  const name = input.deliverable ?? input.deliverableName ?? input.deliverable_name ?? input.name ?? input.title ?? input.item;
  if (typeof name !== 'string') throw bad('Deliverable name is required.');
  const trimmedName = name.replace(/\s+/g, ' ').trim();
  if (!trimmedName) throw bad('Deliverable name is required.');
  if (trimmedName.length > MAX_NAME) throw bad('Deliverable name is too long.');
  const deliverable = trimmedName.slice(0, MAX_NAME);

  const versionRaw = input.version ?? input.deliverableVersion ?? input.deliverable_version;
  let version = '';
  if (versionRaw != null && versionRaw !== '') {
    if (typeof versionRaw !== 'string') throw bad('Version must be text.');
    const trimmedVersion = versionRaw.replace(/\s+/g, ' ').trim();
    if (trimmedVersion.length > MAX_VERSION) throw bad('Version is too long.');
    version = trimmedVersion.slice(0, MAX_VERSION);
  }

  const id = `h${crypto.randomBytes(4).toString('hex')}`;
  const status = reconciliationStatus(events);
  const item = {
    id,
    deliverable,
    deliverableName: deliverable,
    name: deliverable,
    title: deliverable,
    version,
    events,
    status,
    reconciliationStatus: status,
    reconciliation_status: status,
    createdAt: now,
    updatedAt: now,
  };
  return item;
}

function validateCaseAndOwner(caseId, owner) {
  if (!validOwner(owner)) throw bad('Owner is required.');
  if (!safeCaseId(caseId)) throw bad('Invalid case ID.');
}

function list(caseId, owner) {
  validateCaseAndOwner(caseId, owner);
  const items = readItems(caseId.trim(), owner.trim());
  return { items: items.map((it) => ({ ...it })) };
}

function add(caseId, owner, input, locker) {
  validateCaseAndOwner(caseId, owner);
  const cId = caseId.trim();
  const o = owner.trim();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Invalid item fields.');
  const now = new Date().toISOString();

  const eventsInput = input.events ?? input.eventList ?? input.handoffs ?? input.entries ?? [];
  if (!Array.isArray(eventsInput)) throw bad('Events must be a list.');
  if (eventsInput.length > MAX_EVENTS) throw bad(`Too many events (max ${MAX_EVENTS}).`);

  const events = eventsInput.map((ev, i) => validateEvent(ev, locker, i));

  const items = readItems(cId, o);
  if (items.length >= MAX_ITEMS) throw bad(`Too many items (max ${MAX_ITEMS}).`);

  const item = normalizeItem(input, events, now);
  items.push(item);
  writeItems(cId, o, items);
  return { ...item };
}

function remove(caseId, owner, itemId) {
  validateCaseAndOwner(caseId, owner);
  if (typeof itemId !== 'string' || !itemId.trim()) throw bad('Invalid item ID.');
  const cId = caseId.trim();
  const o = owner.trim();
  const id = itemId.trim();
  const items = readItems(cId, o);
  const idx = items.findIndex((it) => it && it.id === id);
  if (idx === -1) return false;
  const next = items.filter((it) => it.id !== id);
  writeItems(cId, o, next);
  return true;
}

function addEvent(caseId, owner, itemId, event, locker) {
  validateCaseAndOwner(caseId, owner);
  if (typeof itemId !== 'string' || !/^h[a-f0-9]{8}$/.test(itemId)) throw bad('Invalid item ID.');
  const items = readItems(caseId.trim(), owner.trim());
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return null;
  if (item.events.length >= MAX_EVENTS) throw bad(`Too many events (max ${MAX_EVENTS}).`);
  const next = validateEvent(event, locker, item.events.length);
  item.events.push(next);
  item.updatedAt = new Date().toISOString();
  item.status = reconciliationStatus(item.events);
  item.reconciliationStatus = item.status;
  item.reconciliation_status = item.status;
  writeItems(caseId.trim(), owner.trim(), items);
  return { ...item };
}

function removeEvent(caseId, owner, itemId, eventId) {
  validateCaseAndOwner(caseId, owner);
  if (typeof itemId !== 'string' || !/^h[a-f0-9]{8}$/.test(itemId)) throw bad('Invalid item ID.');
  if (typeof eventId !== 'string' || !/^evt[a-f0-9]{12}$/.test(eventId)) throw bad('Invalid event ID.');
  const items = readItems(caseId.trim(), owner.trim());
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return false;
  const next = item.events.filter((event) => event.id !== eventId);
  if (next.length === item.events.length) return false;
  item.events = next;
  item.updatedAt = new Date().toISOString();
  item.status = reconciliationStatus(next);
  item.reconciliationStatus = item.status;
  item.reconciliation_status = item.status;
  writeItems(caseId.trim(), owner.trim(), items);
  return true;
}

module.exports = {
  list,
  add,
  remove,
  addEvent,
  removeEvent,
  MAX_ITEMS,
  MAX_EVENTS,
  MAX_NAME,
  MAX_VERSION,
  MAX_NOTE,
  ALLOWED_TYPES: [...ALLOWED_TYPES],
};
