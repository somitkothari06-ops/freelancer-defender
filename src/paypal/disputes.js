// PayPal Disputes API (Resolution Center).
// Reference: https://developer.paypal.com/docs/api/customer-disputes/v1/
const { request } = require('./client');

const base = '/v1/customer/disputes';

// Summary list of the merchant's disputes (newest first).
async function listDisputes({ pageSize = 20 } = {}) {
  const { data } = await request('GET', base, { query: { page_size: pageSize } });
  return data.items || [];
}

// Full dispute details: reason, amount, messages, seller_response_due_date, allowed actions...
async function getDispute(id) {
  const { data } = await request('GET', `${base}/${id}`);
  return data;
}

// Submit evidence. PayPal expects multipart/form-data with a JSON part called "input"
// plus one part per file (PDF/JPG/PNG/GIF).
async function provideEvidence(id, input, files) {
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  for (const f of files) {
    form.append(f.field || 'evidence-file', new Blob([Buffer.from(f.bytes, 'base64')], { type: f.type }), f.name);
  }
  return request('POST', `${base}/${id}/provide-evidence`, { form });
}

// Message the client inside the dispute (INQUIRY stage only).
const sendMessage = (id, message) => request('POST', `${base}/${id}/send-message`, { json: { message } });

// Offer a (partial) refund to resolve the dispute.
const makeOffer = (id, body) => request('POST', `${base}/${id}/make-offer`, { json: body });

// Concede: closes the dispute in the client's favour and refunds them.
const acceptClaim = (id, body) => request('POST', `${base}/${id}/accept-claim`, { json: body });

// ---- Sandbox-only helpers (used to drive a test dispute through its lifecycle) ----

// Move an UNDER_REVIEW dispute to WAITING_FOR_SELLER_RESPONSE so evidence can be submitted.
const requireEvidence = (id, action = 'SELLER_EVIDENCE') =>
  request('POST', `${base}/${id}/require-evidence`, { json: { action } });

// Settle a dispute (as PayPal's reviewer would): BUYER_FAVOR or SELLER_FAVOR.
const adjudicate = (id, outcome) =>
  request('POST', `${base}/${id}/adjudicate`, { json: { adjudication_outcome: outcome } });

module.exports = {
  listDisputes,
  getDispute,
  provideEvidence,
  sendMessage,
  makeOffer,
  acceptClaim,
  requireEvidence,
  adjudicate,
};
