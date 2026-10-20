// The "evidence locker": every document the agent is allowed to look at,
// split into small numbered sections (anchors) so that every claim the
// agent makes can point to one exact place, e.g. "CONTRACT §7.2" or "DELIVERY-LOG L5".
//
// Two documents are built from PayPal data rather than from the freelancer's files:
//   DISPUTE     - the dispute record itself (from the Disputes API)
//   PAYPAL-TXN  - the client's payment history with this freelancer (from the Transaction Search API)

const REASON_LABELS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Service not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized transaction',
  CREDIT_NOT_PROCESSED: 'Credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate transaction',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Canceled recurring billing',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
};

function money(m) {
  return m ? `$${Number(m.value).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${m.currency_code}` : '';
}

// Everything the client wrote when filing. In real PayPal disputes the main complaint is in
// the per-item notes (disputed_transactions[].items[].notes); follow-ups are in messages[].
function statementParts(dispute) {
  const parts = [];
  for (const tx of dispute.disputed_transactions || []) {
    for (const item of tx.items || []) {
      if (item.notes) parts.push({ anchor: `ITEM${parts.length + 1}`, heading: `Client's complaint about "${item.item_name}"`, text: item.notes });
    }
  }
  (dispute.messages || []).forEach((m, i) => {
    parts.push({ anchor: `MSG${i + 1}`, heading: `Message from ${String(m.posted_by).toLowerCase()}`, text: m.content });
  });
  return parts;
}

// Turn the PayPal dispute object into a citable document.
function disputeDocument(dispute) {
  const tx = dispute.disputed_transactions?.[0] || {};
  const sections = [
    {
      anchor: 'REASON',
      heading: 'Filed reason',
      text: `Reason code: ${dispute.reason} (${REASON_LABELS[dispute.reason] || dispute.reason}). ` +
        `Card network code: ${dispute.external_reason_code || 'n/a'}. Channel: ${dispute.dispute_channel}. ` +
        `Stage: ${dispute.dispute_life_cycle_stage}. Amount disputed: ${money(dispute.dispute_amount)}.`,
    },
    {
      anchor: 'TXN',
      heading: 'Disputed transaction',
      text: `PayPal transaction ${tx.seller_transaction_id || 'unknown'} on ${(tx.create_time || '').slice(0, 10)} ` +
        `for ${money(tx.gross_amount)}, invoice ${tx.invoice_number || 'n/a'}, buyer ${tx.buyer?.name || 'unknown'}.`,
    },
  ];
  sections.push(...statementParts(dispute));
  return {
    id: 'DISPUTE',
    title: `PayPal dispute ${dispute.dispute_id}`,
    kind: 'paypal_record',
    source: 'PayPal Disputes API',
    summary: 'The dispute as filed: reason code, disputed transaction and the client\'s own statement.',
    sections,
  };
}

// Turn Transaction Search API rows into a citable document (one section per transaction).
function transactionsDocument(rows, source) {
  return {
    id: 'PAYPAL-TXN',
    title: 'Payment history between this client and the freelancer',
    kind: 'paypal_record',
    source,
    summary: `${rows.length} PayPal transaction(s) from this payer, with dates, amounts, invoice numbers and item details.`,
    sections: rows.map((r) => {
      const t = r.transaction_info;
      const items = (r.cart_info?.item_details || [])
        .map((it) => `${it.item_name} (${money(it.item_amount)})`)
        .join('; ');
      return {
        anchor: t.transaction_id,
        heading: `${t.transaction_initiation_date.slice(0, 10)} - ${money(t.transaction_amount)}`,
        text: `Transaction ${t.transaction_id} on ${t.transaction_initiation_date.slice(0, 10)}: ` +
          `${money(t.transaction_amount)} paid by ${r.payer_info?.email_address || 'unknown payer'}` +
          ` (${r.payer_info?.payer_name?.alternate_full_name || ''}). Status: ${t.transaction_status === 'S' ? 'completed' : t.transaction_status}. ` +
          `Invoice ${t.invoice_id || 'n/a'}. Subject: "${t.transaction_subject || ''}".` +
          (items ? ` Items: ${items}.` : ''),
        // The same facts as label/value pairs, for display only.
        fields: [
          ['Amount', money(t.transaction_amount)],
          ['Date', t.transaction_initiation_date.slice(0, 10)],
          ['Paid by', [r.payer_info?.payer_name?.alternate_full_name, r.payer_info?.email_address].filter(Boolean).join(' · ') || 'Unknown'],
          ['Status', t.transaction_status === 'S' ? 'Completed' : t.transaction_status],
          ['Invoice', t.invoice_id || 'n/a'],
          ['For', t.transaction_subject || ''],
          ...(r.cart_info?.item_details || []).map((it, i) => [i ? '' : 'Items', `${it.item_name} · ${money(it.item_amount)}`]),
          ['Transaction ID', t.transaction_id],
        ],
      };
    }),
  };
}

// --- tiny keyword search -------------------------------------------------

const STOPWORDS = new Set(
  'a an and are as at be by for from has have i in is it of on or our that the this to was we were with you your not no'.split(' ')
);

function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9§#.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Normalise text before comparing a quote with its source (quotes, dashes, spacing, case).
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’‛`]/g, "'")
    .replace(/[“”"]/g, '"')
    .replace(/[‐-—−]/g, '-') // all the hyphen/dash variants
    .replace(/[  ]/g, ' ') // non-breaking spaces
    .replace(/\s+/g, ' ')
    .trim();
}

class Locker {
  constructor(documents) {
    this.docs = new Map(documents.map((d) => [d.id, d]));
  }

  /** Short list of documents: what the agent sees before it opens anything. */
  index() {
    return [...this.docs.values()].map((d) => ({
      doc_id: d.id,
      title: d.title,
      kind: d.kind,
      date: d.date || '',
      source: d.source,
      summary: d.summary,
      sections: d.sections.length,
      added: Boolean(d.added),
    }));
  }

  read(docId) {
    const d = this.docs.get(docId);
    if (!d) return null;
    return { doc_id: d.id, title: d.title, source: d.source, sections: d.sections };
  }

  section(docId, anchor) {
    const d = this.docs.get(docId);
    return d?.sections.find((s) => s.anchor === anchor) || null;
  }

  /**
   * Find the real doc/anchor for a reference the model wrote slightly differently,
   * e.g. doc_id "CONTRACT_3_2" or "CONTRACT §3.2", or anchor "3.2" instead of "§3.2".
   * Only the spelling of the reference is repaired; the quote must still match exactly.
   */
  resolve(docId, anchor) {
    if (this.section(docId, anchor)) return { doc_id: docId, anchor };
    const squash = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const want = squash(`${docId}${anchor}`);
    for (const d of this.docs.values()) {
      if (!want.startsWith(squash(d.id))) continue;
      const rest = want.slice(squash(d.id).length) || squash(anchor);
      const s = d.sections.find((x) => squash(x.anchor) === rest || squash(x.anchor) === squash(anchor));
      if (s) return { doc_id: d.id, anchor: s.anchor };
    }
    return null;
  }

  /** Keyword search across every section; returns the best matches with their anchors. */
  search(query, limit = 6) {
    const q = tokens(query);
    const hits = [];
    for (const d of this.docs.values()) {
      for (const s of d.sections) {
        const words = tokens(`${s.heading} ${s.text}`);
        let score = 0;
        for (const term of q) score += words.filter((w) => w === term || w.startsWith(term)).length;
        if (score > 0) hits.push({ doc_id: d.id, anchor: s.anchor, heading: s.heading, text: s.text, score });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function buildLocker(scenario, { transactions, transactionsSource }) {
  return new Locker([
    disputeDocument(scenario.dispute),
    transactionsDocument(transactions, transactionsSource),
    ...scenario.documents,
  ]);
}

module.exports = { buildLocker, normalize, statementParts, REASON_LABELS, money };
