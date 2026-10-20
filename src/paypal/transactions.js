// PayPal Transaction Search API: the client's full payment history with the freelancer.
// Reference: https://developer.paypal.com/docs/api/transaction-search/v1/
//
// Why this matters: for an "unauthorized" claim, prior undisputed payments from the
// same payer are strong evidence. For other claims, it proves what was paid, when, and for which invoice.
//
// Limits: each query covers at most 31 days, and new sandbox transactions can take
// a few hours to show up in search results.
const { request } = require('./client');

const DAY = 24 * 60 * 60 * 1000;

/**
 * All completed transactions from one payer over the last `months` months.
 * The API can't filter by payer, so we fetch 31-day windows and filter here.
 */
async function historyForPayer(payerEmail, { months = 6 } = {}) {
  const rows = [];
  let end = Date.now();
  const stop = end - months * 30 * DAY;
  while (end > stop) {
    const start = Math.max(stop, end - 31 * DAY + 1000);
    const { data } = await request('GET', '/v1/reporting/transactions', {
      query: {
        start_date: new Date(start).toISOString().replace(/\.\d+Z$/, 'Z'),
        end_date: new Date(end).toISOString().replace(/\.\d+Z$/, 'Z'),
        fields: 'transaction_info,payer_info,cart_info',
        page_size: 500,
      },
    });
    rows.push(...(data.transaction_details || []));
    end = start - 1000;
  }
  const email = String(payerEmail || '').toLowerCase();
  return rows
    .filter((r) => !email || r.payer_info?.email_address?.toLowerCase() === email)
    .filter((r) => Number(r.transaction_info?.transaction_amount?.value) > 0) // payments in, not refunds/fees
    .sort((a, b) => a.transaction_info.transaction_initiation_date.localeCompare(b.transaction_info.transaction_initiation_date));
}

module.exports = { historyForPayer };
