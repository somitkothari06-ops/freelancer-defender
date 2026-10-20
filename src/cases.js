// Where disputes come from.
//
// Two kinds of case appear in the dashboard:
//   seeded  - the demo scenarios in data/scenarios/*.json. Their dispute and transaction
//             records use the exact shape of PayPal's API responses, but they don't live
//             in PayPal. Submissions for them are simulated.
//   live    - real disputes pulled from the PayPal sandbox via the Disputes API. Each one is
//             linked to a scenario's evidence locker (contracts, emails, logs: things
//             PayPal doesn't hold). Submissions for them really go to PayPal.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const disputesApi = require('./paypal/disputes');
const transactionsApi = require('./paypal/transactions');

const SCENARIO_DIR = path.join(__dirname, '..', 'data', 'scenarios');
const HOUR = 60 * 60 * 1000;

const bootTime = Date.now();

// Load every scenario once at startup and fill in the "__DYNAMIC__" timestamps, so the
// countdown always looks like the dispute arrived a few hours ago.
const scenarios = fs
  .readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, f), 'utf8')))
  .map((s) => {
    const created = new Date(bootTime - s.demo.received_hours_ago * HOUR);
    const due = new Date(created.getTime() + s.demo.response_window_hours * HOUR);
    const fill = (v) => (v === '__DYNAMIC__' ? created.toISOString() : v);
    s.dispute.create_time = fill(s.dispute.create_time);
    s.dispute.update_time = fill(s.dispute.update_time);
    s.dispute.seller_response_due_date = due.toISOString();
    s.dispute.messages.forEach((m) => (m.time_posted = fill(m.time_posted)));
    return s;
  });

const scenarioById = new Map(scenarios.map((s) => [s.id, s]));

// Live dispute id -> scenario id (set automatically by invoice number, or by hand in the UI).
const links = new Map();

function summary(dispute, extra) {
  const tx = dispute.disputed_transactions?.[0] || {};
  return {
    dispute_id: dispute.dispute_id,
    reason: dispute.reason,
    status: dispute.status,
    stage: dispute.dispute_life_cycle_stage,
    channel: dispute.dispute_channel,
    amount: Number(dispute.dispute_amount?.value || 0),
    currency: dispute.dispute_amount?.currency_code || 'USD',
    created: dispute.create_time,
    due: dispute.seller_response_due_date,
    invoice: tx.invoice_number || '',
    paid_on: tx.create_time || '',
    ...extra,
  };
}

// Guess which scenario a live sandbox dispute belongs to. scripts/paypal-seed.js creates the
// sandbox invoice with the scenario's exact line items and amount, and PayPal copies the item
// names into the dispute, so we match on those. (PayPal puts its own invoice ID in
// invoice_number, not ours, so that can't be used.)
function autoLink(dispute) {
  const tx = dispute.disputed_transactions?.[0] || {};
  const itemNames = new Set((tx.items || []).map((i) => i.item_name));
  const amount = Number(dispute.dispute_amount?.value || tx.gross_amount?.value || 0);
  const match = scenarios.find((s) => {
    const row = s.paypal_transactions.find((t) => t.transaction_info.invoice_id === s.dispute.disputed_transactions[0].invoice_number);
    const names = (row?.cart_info?.item_details || []).map((i) => i.item_name);
    const sameAmount = Number(s.dispute.dispute_amount.value) === amount;
    return sameAmount && (names.length === 0 || names.some((n) => itemNames.has(n)));
  });
  return match?.id || null;
}

async function listLive() {
  if (!config.paypal.enabled) return { items: [], error: null };
  try {
    const items = await disputesApi.listDisputes();
    // The list endpoint returns summaries; fetch details for the few we show.
    const detailed = await Promise.all(items.slice(0, 10).map((d) => disputesApi.getDispute(d.dispute_id)));
    return {
      items: detailed.map((d) => {
        if (!links.has(d.dispute_id)) {
          const guess = autoLink(d);
          if (guess) links.set(d.dispute_id, guess);
        }
        const sc = scenarioById.get(links.get(d.dispute_id));
        return summary(d, {
          source: 'live',
          scenario_id: sc?.id || null,
          freelancer: sc?.freelancer.name || '',
          client: sc ? `${sc.client.name}, ${sc.client.company}` : d.disputed_transactions?.[0]?.buyer?.name || 'Unknown buyer',
          title: sc?.title || 'Live sandbox dispute (no evidence locker linked yet)',
        });
      }),
      error: null,
    };
  } catch (err) {
    return { items: [], error: err.message };
  }
}

async function listCases() {
  const seeded = scenarios.map((s) =>
    summary(s.dispute, {
      source: 'seeded',
      scenario_id: s.id,
      hero: Boolean(s.hero),
      freelancer: s.freelancer.name,
      client: `${s.client.name}, ${s.client.company}`,
      title: s.title,
    })
  );
  const live = await listLive();
  return { cases: [...live.items, ...seeded], paypal: { enabled: config.paypal.enabled, env: config.paypal.env, error: live.error } };
}

/**
 * Everything the agent needs for one dispute: the scenario (with the live PayPal dispute
 * swapped in if this is a live case), the payment history, and where each piece came from.
 */
async function loadCase(disputeId) {
  const seeded = scenarios.find((s) => s.dispute.dispute_id === disputeId);
  if (seeded) {
    return {
      live: false,
      scenario: seeded,
      transactions: seeded.paypal_transactions,
      sources: {
        dispute: 'Seeded demo record (PayPal Disputes API format)',
        transactions: 'Seeded demo records (PayPal Transaction Search format)',
      },
    };
  }

  // Live sandbox dispute.
  const dispute = await disputesApi.getDispute(disputeId);
  const scenarioId = links.get(disputeId) || autoLink(dispute);
  const base = scenarioById.get(scenarioId);
  if (!base) {
    const err = new Error('This live dispute is not linked to an evidence locker yet. Pick one in the dashboard.');
    err.code = 'NEEDS_LINK';
    throw err;
  }
  const scenario = { ...base, dispute };

  let transactions = [];
  let txSource = 'PayPal Transaction Search API (sandbox, live)';
  try {
    // Search by the real payer on the PayPal dispute, not the demo client's email.
    const payer = dispute.disputed_transactions?.[0]?.buyer?.email || base.client.email;
    transactions = await transactionsApi.historyForPayer(payer);
  } catch (err) {
    txSource = `Transaction Search failed (${err.message}); using seeded records`;
  }
  if (transactions.length === 0) {
    transactions = base.paypal_transactions;
    if (!txSource.startsWith('Transaction Search failed')) {
      txSource = 'Seeded records (Transaction Search returned no rows yet; sandbox can lag by hours)';
    }
  }
  return {
    live: true,
    scenario,
    transactions,
    sources: { dispute: 'PayPal Disputes API (sandbox, live)', transactions: txSource },
  };
}

function linkLive(disputeId, scenarioId) {
  if (!scenarioById.has(scenarioId)) throw new Error(`Unknown scenario ${scenarioId}`);
  links.set(disputeId, scenarioId);
}

module.exports = { listCases, loadCase, linkLive, scenarios };
