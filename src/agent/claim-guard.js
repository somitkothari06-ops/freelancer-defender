// A matching source quotation does not prove an inference about receipt.
// Keep this narrow: a missing event in one service is not proof that a person
// never received files through any route.
const NONRECEIPT = [
  /\b(?:client|buyer|customer|recipient|you|they|he|she)\b.{0,35}\b(?:never|did not|didn't|has not|hasn't|had not|hadn't|was not|wasn't)\b.{0,25}\b(?:receive|received|obtain|obtained|get|got|have|had|access|accessed|download|downloaded|retrieve|retrieved)\b/i,
  /\b(?:files?|packages?|deliverables?|assets?|documents?)\b.{0,35}\b(?:never|were not|weren't|was not|wasn't|not)\b.{0,25}\b(?:received|delivered|obtained|accessed|downloaded|retrieved)\b/i,
  /\b(?:no|zero)\b.{0,25}\b(?:files?|packages?|deliverables?|assets?)\b.{0,25}\b(?:reached|arrived at)\b/i,
];
const ATTRIBUTED = /\b(?:client|buyer|customer|recipient|sender)\b.{0,30}\b(?:reports?|reported|claims?|claimed|says?|said|states?|stated|alleges?|alleged|told us)\b.{0,100}\b(?:never|did not|didn't|has not|hasn't|had not|hadn't|was not|wasn't)\b|\baccording to (?:the )?(?:client|buyer|customer|recipient|sender)\b.{0,100}\b(?:never|did not|didn't|has not|hasn't|had not|hadn't|was not|wasn't)\b/i;
const SAFE_LOG_FACT = /\b(?:no|zero)\b.{0,40}\b(?:download|access|delivery)\s*(?:events?|entries|records?)\b.{0,50}\b(?:recorded|logged|shown|found)\b|\b(?:recorded|logged|shows?|found)\b.{0,45}\b(?:no|zero)\b.{0,25}\b(?:download|access|delivery)\s*(?:events?|entries|records?)\b/i;

function unsupportedNonreceipt(text) {
  return String(text || '').split(/(?<=[.!?])\s+|[;\n]+/).some((sentence) =>
    NONRECEIPT.some((pattern) => pattern.test(sentence)) &&
    !ATTRIBUTED.test(sentence) && !SAFE_LOG_FACT.test(sentence)
  );
}

function safeText(text) {
  return String(text || '').split(/(?<=[.!?])\s+|[;\n]+/).map((sentence) =>
    unsupportedNonreceipt(sentence)
      ? 'The available records do not establish whether the client received the files.'
      : sentence
  ).join(' ');
}

function safeDiagnosis(diagnosis) {
  let blocked = false;
  const clean = (value) => {
    if (typeof value === 'string') {
      blocked ||= unsupportedNonreceipt(value);
      return safeText(value);
    }
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  };
  return { diagnosis: clean(diagnosis), blocked };
}

function safeDraft(draft) {
  const removed = [];
  const claims = draft.claims.filter((claim) => {
    if (!unsupportedNonreceipt(claim.text)) return true;
    removed.push({ text: claim.text, problems: ['Receipt is not established by the available records.'] });
    return false;
  });
  return {
    draft: { ...draft, claims, client_message: safeText(draft.client_message) },
    removed,
  };
}

module.exports = { unsupportedNonreceipt, safeText, safeDiagnosis, safeDraft };
