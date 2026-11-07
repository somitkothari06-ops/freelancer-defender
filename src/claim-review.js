// A user action gate, not a semantic verifier. The freelancer must inspect every
// source-linked claim before a live PayPal submission.
function allClaimsReviewed(claims, reviewed) {
  if (!Array.isArray(claims) || !claims.length || !Array.isArray(reviewed)) return false;
  if (reviewed.length !== claims.length || new Set(reviewed).size !== claims.length) return false;
  return reviewed.every((index) => Number.isInteger(index) && index >= 0 && index < claims.length);
}

module.exports = { allClaimsReviewed };
