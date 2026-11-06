// Editorial demo map. Each source excerpt is read from the actual evidence locker;
// these labels describe what a record establishes, not an AI confidence score.
const HALDEN = [
  { track: 'Bank response', title: 'Print files were in the agreed scope', state: 'supported', finding: 'The signed agreement includes vector masters and a copyright assignment in the final package.', source: ['CONTRACT', '§3.2'] },
  { track: 'Bank response', title: 'A handoff link was sent', state: 'supported', finding: 'The email names two download packages. Sending a link does not prove receipt of every file.', source: ['EMAILS', 'E6'] },
  { track: 'Bank response', title: 'Master package access is unproven', state: 'unknown', finding: 'This transfer service recorded zero master-package downloads before the link expired. Other delivery routes remain possible.', source: ['DELIVERY-LOG', 'L5'] },
  { track: 'Client concern', title: 'The client reports a sign-maker problem', state: 'reported', finding: 'A contact-form submission says the available files are only suitable for screens. The sender account has not been independently checked.', source: ['CONTACT-FORM', 'F1'] },
  { track: 'Client concern', title: 'A reissue path exists', state: 'supported', finding: 'The agreement says the studio will reissue the final package on request within the stated period.', source: ['CONTRACT', '§7.2'] },
];

function buildProofMap(caseData, locker) {
  if (caseData.live || caseData.scenario.id !== 'halden-brand') return null;
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

module.exports = { buildProofMap };
