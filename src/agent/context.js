// Keep direct client communication in the diagnosis context even when the
// investigative tool loop overlooks it. A submitted message is a reported
// concern, not independent proof that the sender's account is true.
function directConcernRefs(locker, maxChars = 12000) {
  const matches = [...locker.docs.values()].filter((doc) =>
    doc.kind === 'correspondence' || /contact form|client (message|report|submission)|chat|email/i.test(`${doc.title} ${doc.summary || ''}`)
  );
  const refs = [];
  let used = 0;
  for (const doc of matches) {
    for (const section of doc.sections) {
      const length = String(section.heading || '').length + String(section.text || '').length;
      if (used + length > maxChars) continue;
      refs.push({ doc_id: doc.id, anchor: section.anchor });
      used += length;
    }
  }
  return refs;
}

module.exports = { directConcernRefs };
