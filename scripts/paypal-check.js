// Checks that your PayPal sandbox credentials work and which APIs your app can reach.
//   npm run paypal:check
const config = require('../src/config');
const { getToken, request } = require('../src/paypal/client');

async function step(name, fn) {
  try {
    const out = await fn();
    console.log(`  ✓ ${name}${out ? ` - ${out}` : ''}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name} - ${err.message}`);
    return false;
  }
}

(async () => {
  console.log(`PayPal environment: ${config.paypal.env} (${config.paypal.baseUrl})`);
  if (!config.paypal.enabled) {
    console.log('  ✗ PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set. See NOTES.md, "Credentials".');
    process.exit(1);
  }
  const ok = await step('OAuth token', async () => {
    await getToken();
    return 'credentials accepted';
  });
  if (!ok) process.exit(1);

  await step('Disputes API: list disputes', async () => {
    const { data } = await request('GET', '/v1/customer/disputes', { query: { page_size: 10 } });
    const items = data.items || [];
    return `${items.length} dispute(s)${items.length ? ': ' + items.map((d) => `${d.dispute_id} (${d.status})`).join(', ') : ''}`;
  });

  await step('Transaction Search API: last 30 days', async () => {
    const end = new Date();
    const start = new Date(end - 30 * 864e5);
    const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
    const { data } = await request('GET', '/v1/reporting/transactions', {
      query: { start_date: iso(start), end_date: iso(end), fields: 'transaction_info,payer_info', page_size: 100 },
    });
    return `${(data.transaction_details || []).length} transaction(s)`;
  });

  await step('Invoicing API: list invoices', async () => {
    const { data } = await request('GET', '/v2/invoicing/invoices', { query: { page_size: 5 } });
    return `${data.total_items ?? (data.items || []).length} invoice(s)`;
  });
})();
