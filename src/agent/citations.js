// Deterministic citation checker. No AI involved, on purpose.
//
// Every claim in the drafted response must carry at least one citation of the form
//   { doc_id: "CONTRACT", anchor: "§7.2", quote: "exact words from that section" }
// A citation passes only if the document exists, the anchor exists in that document,
// and the quote really appears in that section's text. A quote may skip words
// with "..." as long as each piece appears, in order.
const { normalize } = require('../evidence/locker');

const NEGATION = /\b(not|never|no|none|nor|cannot|without)\b|n't\b/;

function checkCitation(locker, c) {
  // Repair the reference's spelling if needed (never the quote).
  const ref = locker.resolve(c.doc_id, c.anchor);
  if (ref) Object.assign(c, ref);
  const section = locker.section(c.doc_id, c.anchor);
  if (!locker.docs.has(c.doc_id)) return { ok: false, problem: `document ${c.doc_id} does not exist` };
  if (!section) return { ok: false, problem: `${c.doc_id} has no section ${c.anchor}` };

  // The heading counts as part of the section (models often quote "Heading: text").
  const source = normalize(`${section.heading}: ${section.text}`);
  const pieces = normalize(c.quote || '')
    .replace(/^"|"$/g, '')
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ''))
    .filter(Boolean);
  if (pieces.length === 0 || pieces.join('').length < 8) {
    return { ok: false, problem: 'quote is missing or too short to verify' };
  }

  // With "...", every piece must be a real phrase (2+ words), so "t...h...e" can't pass.
  if (pieces.length > 1 && pieces.some((p) => p.split(' ').length < 2)) {
    return { ok: false, problem: 'each part of a quote with "..." must be at least two words' };
  }

  let from = 0;
  for (const [i, piece] of pieces.entries()) {
    const at = source.indexOf(piece, from);
    if (at === -1) return { ok: false, problem: `quote not found in ${c.doc_id} ${c.anchor}: "${piece}"` };
    // The words skipped by "..." must not flip the meaning ("has ... approved" over "has not approved").
    if (i > 0 && NEGATION.test(source.slice(from, at))) {
      return { ok: false, problem: `the "..." in the quote skips a negation in ${c.doc_id} ${c.anchor}` };
    }
    from = at + piece.length;
  }
  return { ok: true };
}

/**
 * Check every claim. Returns per-claim results plus totals.
 * A claim is "grounded" when it has >=1 citation and all of its citations pass.
 */
function verifyClaims(locker, claims) {
  const results = claims.map((claim, i) => {
    // checkCitation repairs the reference on `c` in place, so spread `c` after it has run.
    const checks = (claim.citations || []).map((c) => {
      const r = checkCitation(locker, c);
      return { ...c, ...r };
    });
    const grounded = checks.length > 0 && checks.every((c) => c.ok);
    return { index: i, text: claim.text, citations: checks, grounded };
  });
  const grounded = results.filter((r) => r.grounded).length;
  const totalCitations = results.reduce((n, r) => n + r.citations.length, 0);
  const passedCitations = results.reduce((n, r) => n + r.citations.filter((c) => c.ok).length, 0);
  return { results, grounded, total: results.length, totalCitations, passedCitations };
}

module.exports = { checkCitation, verifyClaims };
