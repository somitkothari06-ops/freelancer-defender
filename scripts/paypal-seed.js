// Creates a REAL PayPal sandbox invoice for a demo scenario, so you can turn it into a
// real sandbox dispute:
//
//   1. npm run paypal:seed -- halden-brand
//      -> sends an invoice from your sandbox business account to your sandbox buyer
//   2. Log in at https://www.sandbox.paypal.com as the sandbox BUYER and pay the invoice
//   3. As the buyer, open the Resolution Center, report a problem with that payment
//      (e.g. "not as described") and paste the scenario's statement (printed below)
//   4. Open the dashboard: the dispute appears with a "PayPal live" badge, already linked
//      to the scenario's evidence locker (matched by invoice number)
//
// Needs PAYPAL_SANDBOX_BUYER_EMAIL in .env (developer.paypal.com -> Sandbox -> Accounts -> the Personal account).
require('dotenv').config();
const { scenarios } = require('../src/cases');
const { request } = require('../src/paypal/client');

(async () => {
  const id = process.argv[2] || 'halden-brand';
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario "${id}". Options: ${scenarios.map((x) => x.id).join(', ')}`);
  const buyer = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (!buyer) throw new Error('Set PAYPAL_SANDBOX_BUYER_EMAIL in .env first (your sandbox Personal account email).');

  // Invoice numbers must be unique per account, so add a short suffix. cases.js matches on the prefix.
  const tx = s.paypal_transactions.find((t) => t.transaction_info.invoice_id === s.dispute.disputed_transactions[0].invoice_number);
  const invoiceNumber = `${tx.transaction_info.invoice_id}-${Math.random().toString(36).slice(2, 6)}`;
  const items = tx.cart_info?.item_details?.length
    ? tx.cart_info.item_details.map((it) => ({ name: it.item_name.slice(0, 200), quantity: '1', unit_amount: it.item_amount, unit_of_measure: 'AMOUNT' }))
    : [{ name: tx.transaction_info.transaction_subject.slice(0, 200), quantity: '1', unit_amount: tx.transaction_info.transaction_amount, unit_of_measure: 'AMOUNT' }];

  const [given, ...rest] = s.client.name.split(' ');
  const draft = await request('POST', '/v2/invoicing/invoices', {
    json: {
      detail: {
        invoice_number: invoiceNumber,
        currency_code: tx.transaction_info.transaction_amount.currency_code,
        note: `${s.freelancer.business}: ${s.title}`,
        terms_and_conditions: 'Payment due on receipt.',
      },
      primary_recipients: [{ billing_info: { name: { given_name: given, surname: rest.join(' ') || given }, email_address: buyer } }],
      items,
    },
  });
  const invoiceId = (draft.data.href || draft.data.links?.[0]?.href || '').split('/').pop() || draft.data.id;
  const sent = await request('POST', `/v2/invoicing/invoices/${invoiceId}/send`, { json: { send_to_recipient: true } });

  console.log(`Invoice ${invoiceNumber} (${invoiceId}) sent to ${buyer}.`);
  console.log(`Pay it as the sandbox buyer: ${sent.data.href || '(open the buyer inbox at sandbox.paypal.com)'}`);
  console.log('\nThen open a dispute as the buyer and paste this statement:\n');
  console.log(s.dispute.messages[0].content.replace(/^Cardholder statement forwarded by issuing bank[^:]*: /, ''));
})().catch((err) => {
  console.error(err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
