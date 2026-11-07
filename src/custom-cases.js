// "Try your own case": disputes typed in by a visitor instead of pulled from PayPal.
//
// Each one is stored as a dispute object in PayPal's Disputes API format, so the agent,
// the evidence locker and the response package treat it exactly like a real one.
// Cases are unlisted (only reachable by their id, which the creator's browser remembers)
// and kept in data/custom/, which Render's free plan wipes on each deploy or restart.
// Sending is always simulated: these disputes don't exist inside PayPal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'custom');
const PREFIX = 'MY-';
const REASONS = ['MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'UNAUTHORISED', 'OTHER'];

const isCustom = (id) => String(id).startsWith(PREFIX);
const file = (id) => path.join(DIR, `${String(id).replace(/[^\w-]/g, '')}.json`);

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function create(input = {}, owner = '') {
  const client = clean(input.client, 80);
  const statement = String(input.statement ?? '').trim().slice(0, 2000);
  const work = clean(input.work, 120);
  const amount = Number(String(input.amount ?? '').replace(/[^0-9.]/g, ''));
  const reason = REASONS.includes(input.reason) ? input.reason : 'OTHER';
  if (!client) throw bad("Who is the client? Add their name or company.");
  if (!statement) throw bad('Paste what the client told their bank or PayPal.');
  if (!(amount > 0 && amount < 1e7)) throw bad('Enter the amount they are disputing, e.g. 1200.');

  const id = `${PREFIX}${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
  const now = new Date();
  const value = amount.toFixed(2);
  const custom = {
    id,
    owner,
    freelancer: { name: clean(input.freelancer, 80) || 'You', business: clean(input.freelancer, 80) || 'Your business' },
    client: { name: client, company: client, email: '' },
    title: work || 'Your case',
    dispute: {
      dispute_id: id,
      create_time: now.toISOString(),
      update_time: now.toISOString(),
      reason,
      status: 'WAITING_FOR_SELLER_RESPONSE',
      dispute_amount: { currency_code: 'USD', value },
      dispute_channel: 'EXTERNAL',
      dispute_life_cycle_stage: 'CHARGEBACK',
      seller_response_due_date: null, // Entered cases are examples, not PayPal deadlines.
      disputed_transactions: [{
        seller_transaction_id: 'not-from-paypal',
        create_time: '',
        gross_amount: { currency_code: 'USD', value },
        buyer: { name: client },
        items: [{ item_name: work || 'Your work', notes: statement }],
      }],
      messages: [],
    },
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(id), JSON.stringify(custom, null, 1), { flag: 'wx' });
  return custom;
}

function get(id, owner = '') {
  if (!isCustom(id)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    return owner && value.owner === owner ? value : null;
  } catch {
    return null;
  }
}

module.exports = { create, get, isCustom, REASONS };
