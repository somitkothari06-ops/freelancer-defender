// Turns the agent's verified draft into the exact PayPal Disputes API calls to make:
//   provide-evidence  (multipart: JSON "input" + PDF files)
//   send-message      (only possible in the INQUIRY stage; otherwise it becomes an email draft)
//   make-offer        (when the strategy includes a partial refund)
//   accept-claim      (when the agent concludes the client is right)
const { makePdf } = require('./pdf');
const { REASON_LABELS } = require('../evidence/locker');
const playbookFor = require('./playbook');

function buildPackage({ scenario, locker, draft, strategy }) {
  const { dispute, freelancer, client } = scenario;
  const currency = dispute.dispute_amount?.currency_code || 'USD';

  // Number every distinct citation so the letter can use footnotes [1], [2]...
  const footnotes = [];
  const keyOf = (c) => `${c.doc_id} ${c.anchor}`;
  const numberFor = (c) => {
    let i = footnotes.findIndex((f) => keyOf(f) === keyOf(c));
    if (i === -1) {
      footnotes.push({ doc_id: c.doc_id, anchor: c.anchor, quote: c.quote });
      i = footnotes.length - 1;
    }
    return i + 1;
  };
  const paragraphs = draft.claims.map((cl) => {
    const nums = [...new Set(cl.citations.map(numberFor))];
    return `${cl.text} [${nums.join('][')}]`;
  });

  // --- The response letter (PDF) ---
  const letterBlocks = [
    { text: draft.response_title, size: 15, bold: true },
    {
      text: `Dispute ${dispute.dispute_id} - ${REASON_LABELS[dispute.reason] || dispute.reason} - ` +
        `${dispute.dispute_amount.value} ${currency}`,
      size: 10,
      gap: 4,
    },
    { text: `Submitted by ${freelancer.name}, ${freelancer.business} (${freelancer.email})`, size: 10 },
    ...paragraphs.map((p) => ({ text: p, size: 11, gap: 8 })),
    { text: 'Sources', size: 12, bold: true, gap: 16 },
    ...footnotes.map((f, i) => {
      const doc = locker.docs.get(f.doc_id);
      return { text: `[${i + 1}] ${doc.title}, ${f.anchor} (${doc.source}): "${f.quote}"`, size: 9, gap: 3 };
    }),
  ];

  // --- The evidence appendix (PDF): full text of every cited section ---
  const appendixBlocks = [{ text: 'Evidence appendix: full text of every cited section', size: 14, bold: true }];
  const byDoc = new Map();
  for (const f of footnotes) {
    if (!byDoc.has(f.doc_id)) byDoc.set(f.doc_id, new Set());
    byDoc.get(f.doc_id).add(f.anchor);
  }
  for (const [docId, anchors] of byDoc) {
    const doc = locker.docs.get(docId);
    appendixBlocks.push({ text: `${doc.title} - source: ${doc.source}`, size: 11, bold: true, gap: 12 });
    for (const a of anchors) {
      const s = locker.section(docId, a);
      appendixBlocks.push({ text: `${a} ${s.heading}: ${s.text}`, size: 9, gap: 3 });
    }
  }

  const files = [
    { field: 'evidence-file', name: 'response-letter.pdf', type: 'application/pdf', bytes: makePdf(letterBlocks) },
    { field: 'evidence-file', name: 'evidence-appendix.pdf', type: 'application/pdf', bytes: makePdf(appendixBlocks) },
  ];

  // Pick the PayPal evidence_type: the first one the agent chose that PayPal accepts for this reason.
  const allowed = new Set([...playbookFor(dispute.reason).evidenceTypes, 'OTHER']);
  const types = draft.evidence_package.map((e) => e.evidence_type).filter((t) => allowed.has(t));
  const evidenceType = types[0] || 'OTHER';

  const notes = paragraphs.join('\n\n').slice(0, 2000);
  const actions = [];

  if (strategy.decision !== 'ACCEPT_AND_REFUND') {
    actions.push({
      kind: 'provide_evidence',
      label: 'Submit evidence to PayPal',
      method: 'POST',
      path: `/v1/customer/disputes/${dispute.dispute_id}/provide-evidence`,
      contentType: 'multipart/form-data',
      input: {
        evidences: [
          {
            evidence_type: evidenceType,
            notes,
            documents: files.map((f) => ({ name: f.name })),
          },
        ],
      },
      files: files.map(({ bytes, ...f }) => ({ ...f, size: bytes.length })),
    });
  }

  // The model writes amounts freely ("$250", "1,250.00"); read the number and never offer
  // more than the disputed amount.
  const disputed = Number(dispute.dispute_amount?.value) || Infinity;
  const refund = Math.min(parseMoney(strategy.refund_amount), disputed);
  if (strategy.decision === 'PARTIAL_REFUND_AND_CONTEST' && refund > 0) {
    actions.push({
      kind: 'make_offer',
      label: `Offer a ${refund.toFixed(2)} ${currency} partial refund`,
      method: 'POST',
      path: `/v1/customer/disputes/${dispute.dispute_id}/make-offer`,
      contentType: 'application/json',
      body: {
        note: strategy.resolution_action.slice(0, 2000),
        offer_amount: { currency_code: currency, value: refund.toFixed(2) },
        offer_type: 'REFUND',
      },
    });
  }
  if (strategy.decision === 'ACCEPT_AND_REFUND') {
    actions.push({
      kind: 'accept_claim',
      label: 'Accept the claim and refund',
      method: 'POST',
      path: `/v1/customer/disputes/${dispute.dispute_id}/accept-claim`,
      contentType: 'application/json',
      body: { note: strategy.rationale.slice(0, 2000) },
    });
  }

  // PayPal only lets the parties message each other during the INQUIRY stage.
  // Later on (e.g. a bank chargeback) the message goes out as a normal email instead.
  if (dispute.dispute_life_cycle_stage === 'INQUIRY') {
    actions.push({
      kind: 'send_message',
      label: `Message ${client.name} through PayPal`,
      method: 'POST',
      path: `/v1/customer/disputes/${dispute.dispute_id}/send-message`,
      contentType: 'application/json',
      body: { message: draft.client_message.slice(0, 2000) },
    });
  } else {
    actions.push({
      kind: 'email',
      label: `Email ${client.name} directly`,
      to: client.email,
      note: 'PayPal messaging is closed in the chargeback stage, so this goes by email.',
      body: { message: draft.client_message },
    });
  }

  return {
    actions,
    footnotes,
    letter: paragraphs,
    clientMessage: draft.client_message,
    evidencePackage: draft.evidence_package,
    // The raw PDF bytes stay on the server (base64) so the submit step can attach them.
    _files: files.map((f) => ({ ...f, bytes: f.bytes.toString('base64') })),
  };
}

function parseMoney(x) {
  const n = parseFloat(String(x ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { buildPackage };
