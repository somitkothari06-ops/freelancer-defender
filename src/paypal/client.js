// Small PayPal REST client: gets an OAuth token and makes authenticated calls.
// Docs: https://developer.paypal.com/api/rest/authentication/
const config = require('../config');

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new PayPalError(res.status, data, 'POST /v1/oauth2/token');
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

class PayPalError extends Error {
  constructor(status, body, where) {
    super(`PayPal ${status} on ${where}: ${body?.message || body?.error_description || body?.name || JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
    this.debugId = body?.debug_id;
  }
}

/**
 * Make a PayPal API call.
 * @param {string} method
 * @param {string} path        e.g. "/v1/customer/disputes"
 * @param {object} [opts]
 * @param {object} [opts.query]  query-string parameters
 * @param {object} [opts.json]   JSON body
 * @param {FormData} [opts.form] multipart body (for evidence uploads)
 */
async function request(method, path, { query, json, form } = {}) {
  if (!config.paypal.enabled) throw new Error('PayPal credentials are not configured (see NOTES.md).');
  const url = new URL(config.paypal.baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, v);

  const headers = { Authorization: `Bearer ${await getToken()}` };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // fetch sets the multipart boundary itself
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) throw new PayPalError(res.status, data, `${method} ${path}`);
  return { data, debugId: res.headers.get('paypal-debug-id') };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

module.exports = { request, getToken, PayPalError };
