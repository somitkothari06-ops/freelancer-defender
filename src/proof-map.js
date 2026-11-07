// Scope-to-proof map shown in the desktop workbench.
//
// The Halden case has a curated, two-track map whose wording is part of the demo
// narrative. Every other case gets a conservative, source-linked map: rows only
// point at sections that actually exist in the evidence locker, and their wording
// never claims receipt, approval, delivery, or a legal outcome that the records
// do not establish. Unknowns stay unknown; missing records become review prompts.
const HALDEN = [
  { track: 'Bank response', title: 'Print files were in the agreed scope', state: 'supported', finding: 'The signed agreement includes vector masters and a copyright assignment in the final package.', source: ['CONTRACT', '§3.2'] },
  { track: 'Bank response', title: 'A handoff link was sent', state: 'supported', finding: 'The email names two download packages. Sending a link does not prove receipt of every file.', source: ['EMAILS', 'E6'] },
  { track: 'Bank response', title: 'Master package access is unproven', state: 'unknown', finding: 'This transfer service recorded zero master-package downloads before the link expired. Other delivery routes remain possible.', source: ['DELIVERY-LOG', 'L5'] },
  { track: 'Client concern', title: 'The client reports a sign-maker problem', state: 'reported', finding: 'A contact-form submission says the available files are only suitable for screens. The sender account has not been independently checked.', source: ['CONTACT-FORM', 'F1'] },
  { track: 'Client concern', title: 'A reissue path exists', state: 'supported', finding: 'The agreement says the studio will reissue the final package on request within the stated period.', source: ['CONTRACT', '§7.2'] },
];

function buildHaldenMap(locker) {
  const rows = HALDEN.map((row) => {
    const [docId, anchor] = row.source;
    const section = locker.read(docId)?.sections.find((item) => item.anchor === anchor);
    return section && { ...row, source: { docId, anchor, excerpt: section.text, provenance: 'Seeded demo document' } };
  }).filter(Boolean);
  if (rows.length !== HALDEN.length) return null;
  return {
    rows,
    challenge: {
      question: 'Which exact files reached the sign maker?',
      reason: 'The transfer export only records activity in that service; it cannot establish what was received elsewhere.',
      next: 'Ask for the file list the sign maker received and any reissue request or reply.',
      source: { docId: 'DELIVERY-LOG', anchor: 'L5' },
    },
  };
}

function provenanceFor(locker, docId) {
  const doc = locker?.docs?.get?.(docId);
  if (!doc) return 'Case record';
  if (doc.kind === 'paypal_record') return 'PayPal record';
  if (doc.added) return 'Freelancer-added record';
  return 'Case record';
}

function pickAnchor(locker, docId, preferred) {
  const read = locker?.read?.(docId);
  if (!read?.sections?.length) return null;
  if (preferred && read.sections.some((section) => section.anchor === preferred)) return preferred;
  return read.sections[0].anchor;
}

function makeRow(track, title, state, finding, docId, anchor, locker) {
  const read = locker?.read?.(docId);
  const resolvedAnchor = read?.sections?.some((section) => section.anchor === anchor)
    ? anchor
    : (read?.sections?.[0]?.anchor || anchor);
  const resolvedDocId = read ? docId : 'DISPUTE';
  const finalRead = locker?.read?.(resolvedDocId);
  const finalAnchor = finalRead?.sections?.some((section) => section.anchor === resolvedAnchor)
    ? resolvedAnchor
    : (finalRead?.sections?.[0]?.anchor || resolvedAnchor);
  const section = finalRead?.sections?.find((item) => item.anchor === finalAnchor);
  return {
    track,
    title,
    state,
    finding,
    source: {
      docId: resolvedDocId,
      anchor: finalAnchor,
      excerpt: section ? section.text : '',
      provenance: provenanceFor(locker, resolvedDocId),
    },
  };
}

function clientStatementAnchor(locker) {
  const read = locker?.read?.('DISPUTE');
  if (!read?.sections?.length) return null;
  const item = read.sections.find((section) => String(section.anchor).startsWith('ITEM'));
  if (item) return item.anchor;
  const buyerMessage = read.sections.find((section) => /^MSG/i.test(section.anchor) && /buyer/i.test(section.heading || ''));
  if (buyerMessage) return buyerMessage.anchor;
  const anyMessage = read.sections.find((section) => /^MSG/i.test(section.anchor));
  if (anyMessage) return anyMessage.anchor;
  return null;
}

function buildGenericProofMap(caseData, locker) {
  if (!locker || typeof locker.read !== 'function') return null;

  const docs = typeof locker.docs?.values === 'function' ? [...locker.docs.values()] : [];
  const nonPayPal = docs.filter((doc) => doc.kind !== 'paypal_record');

  const agreementDoc = nonPayPal.find((doc) => doc.kind === 'contract') || nonPayPal[0] || null;
  const deliveryDoc = nonPayPal.find((doc) => doc.kind === 'log' || doc.kind === 'messages') || nonPayPal[0] || null;

  const agreementExists = nonPayPal.some((doc) => doc.kind === 'contract');
  const agreementDocId = agreementDoc ? agreementDoc.id : 'DISPUTE';
  const agreementAnchor = pickAnchor(locker, agreementDocId, agreementDoc?.sections?.[0]?.anchor);

  const deliveryDocId = deliveryDoc ? deliveryDoc.id : 'DISPUTE';
  const deliveryAnchor = pickAnchor(locker, deliveryDocId, deliveryDoc?.sections?.[0]?.anchor);

  const confirmAnchor = pickAnchor(locker, 'DISPUTE', 'TXN');

  const clientAnchor = clientStatementAnchor(locker) || pickAnchor(locker, 'DISPUTE', 'REASON');

  const rows = [
    makeRow(
      'Bank response',
      agreementExists ? 'Agreement to review' : 'Agreement needed',
      'unknown',
      agreementExists ? 'An agreement is in the case file. Compare its terms with the client concern.' : 'Add the agreement or scope record before evaluating what was promised.',
      agreementDocId,
      agreementAnchor,
      locker
    ),
    makeRow(
      'Bank response',
      'Delivery or message record to inspect',
      'unknown',
      'Delivery or message record to inspect.',
      deliveryDocId,
      deliveryAnchor,
      locker
    ),
    makeRow(
      'Bank response',
      'Receipt and approval to check',
      'unknown',
      'Inspect the available records for receipt or approval; this map has not checked them.',
      'DISPUTE',
      confirmAnchor,
      locker
    ),
    makeRow(
      'Client concern',
      clientStatementAnchor(locker) ? 'Client statement to review' : 'Filed dispute reason',
      'reported',
      clientStatementAnchor(locker) ? 'The client statement is in the case file; its accuracy has not been checked.' : 'The filed reason is in the case record; no client statement was identified here.',
      'DISPUTE',
      clientAnchor,
      locker
    ),
  ];

  const challengeDoc = deliveryDoc || agreementDoc || null;
  const challengeDocId = challengeDoc ? challengeDoc.id : 'DISPUTE';
  let challengeAnchor = pickAnchor(locker, challengeDocId, challengeDoc?.sections?.[0]?.anchor);
  if (!challengeAnchor) {
    challengeAnchor = pickAnchor(locker, 'DISPUTE', 'REASON');
  }
  if (!challengeAnchor) {
    const first = locker.read('DISPUTE')?.sections?.[0];
    challengeAnchor = first ? first.anchor : null;
  }

  const challenge = {
    question: 'Which records establish the agreed scope and the actual handoff?',
    reason: 'Check what each record actually establishes about scope, handoff, receipt, and the client concern.',
    next: 'Provide the signed agreement and the delivery or handoff record, then compare both with the client statement.',
    source: { docId: challengeDocId, anchor: challengeAnchor },
  };

  // Ensure the challenge source is real.
  const challengeRead = locker.read(challenge.source.docId);
  if (!challengeRead?.sections?.some((section) => section.anchor === challenge.source.anchor)) {
    challenge.source.docId = 'DISPUTE';
    challenge.source.anchor = pickAnchor(locker, 'DISPUTE', 'REASON') || locker.read('DISPUTE')?.sections?.[0]?.anchor;
  }

  return { rows, challenge };
}

function buildProofMap(caseData, locker) {
  if (!caseData?.live && caseData?.scenario?.id === 'halden-brand') {
    const halden = buildHaldenMap(locker);
    if (halden) return halden;
  }
  return buildGenericProofMap(caseData, locker);
}

module.exports = { buildProofMap };
