// Evidence the freelancer adds themselves: a contract, an email thread, a delivery log...
//
// PayPal holds the dispute and the payment, but the proof that work was agreed and
// delivered lives with the freelancer. Pasted or uploaded text is split into small
// numbered sections, the same shape as the demo evidence, so the agent can cite and
// quote it and the verifier can check every quote.
//
// Stored as JSON per dispute in data/uploads/ (on Render's free plan this resets on
// each deploy or restart).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
const KINDS = {
  contract: { label: 'Contract or agreement', prefix: '§' },
  messages: { label: 'Emails or messages', prefix: 'M' },
  log: { label: 'Delivery or activity log', prefix: 'L' },
  other: { label: 'Other document', prefix: 'P' },
};
const MAX_TEXT = 200_000;
const MAX_SECTIONS = 80;
const MAX_SECTION_CHARS = 1200;

const file = (disputeId) => path.join(DIR, `${String(disputeId).replace(/[^\w-]/g, '')}.json`);

function list(disputeId) {
  try {
    return JSON.parse(fs.readFileSync(file(disputeId), 'utf8'));
  } catch {
    return [];
  }
}

function save(disputeId, docs) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(disputeId), JSON.stringify(docs, null, 1));
}

// "Client contract (signed)" -> "CLIENT-CONTRACT-SIGNED", unique among existing ids.
function makeId(title, taken) {
  // Trim long titles at a whole word: "VIDEO-PRODUCTION", not "VIDEO-PRODUCTION-AGREEME".
  const full = title.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cut = full.length <= 24 ? full : full.slice(0, 25).replace(/-[^-]*$/, '') || full.slice(0, 24);
  const base = cut || 'DOC';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const firstWords = (s, n = 70) => {
  const line = s.split('\n')[0].trim();
  return line.length > n ? `${line.slice(0, n).replace(/\s+\S*$/, '')}...` : line;
};

// Split an over-long block at sentence ends so each section stays quotable.
function chunk(text) {
  if (text.length <= MAX_SECTION_CHARS) return [text];
  const parts = [];
  let cur = '';
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) || [text]) {
    if (cur && (cur + sentence).length > MAX_SECTION_CHARS) {
      parts.push(cur.trim());
      cur = '';
    }
    cur += sentence;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Contract clause headings: "3.2 Final Asset Package", "§ 6.1 Ownership", "Section 4 - Fees", "7. Refunds".
// A bare leading number only counts when it looks like numbering ("7." "7)" "3.2"), so a
// sentence like "30 days after delivery..." isn't mistaken for clause 30.
const CLAUSE = /^(?:(?:§\s*|section\s+|clause\s+|article\s+)(\d+(?:\.\d+)*)[.):]?|(\d+(?:\.\d+)+)\.?|(\d+)[.)])\s*[-–—:]?\s*(.*)$/i;
const clause = (line) => {
  const m = line.match(CLAUSE);
  return m && [m[0], m[1] || m[2] || m[3], m[4]];
};

/**
 * Split raw text into sections: { anchor, heading, text }.
 *   contract  numbered clauses become §n anchors; unnumbered paragraphs become Pn
 *   log       one section per non-empty line (logs are line-based)
 *   messages  one section per paragraph or message
 *   other     one section per paragraph
 */
function splitDocument(raw, kind) {
  const text = String(raw).replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  const prefix = (KINDS[kind] || KINDS.other).prefix;
  const sections = [];
  const used = new Set();
  const add = (anchor, heading, body) => {
    for (const part of chunk(body)) {
      let a = anchor;
      for (let n = 2; used.has(a); n++) a = `${anchor}-${n}`;
      used.add(a);
      sections.push({ anchor: a, heading, text: part });
    }
  };

  if (kind === 'log') {
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => add(`L${i + 1}`, firstWords(line, 60), line));
    return sections.slice(0, MAX_SECTIONS);
  }

  // Paragraphs; a short heading-only line is joined to the paragraph after it.
  const blocks = [];
  for (const b of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const prev = blocks[blocks.length - 1];
    const startsClause = kind === 'contract' && clause(b.split('\n')[0].trim());
    if (prev && !startsClause && !prev.includes('\n') && prev.length < 80 && !/[.!?]$/.test(prev)) blocks[blocks.length - 1] = `${prev}\n${b}`;
    else blocks.push(b);
  }

  let para = 0;
  for (const block of blocks) {
    const [first, ...rest] = block.split('\n');
    const m = kind === 'contract' ? clause(first.trim()) : null;
    if (m && (m[2] || rest.length)) {
      // "3.2 Final Asset Package\n<body>" or "3.2 The Studio will deliver..."
      const titleOnly = rest.length && m[2].length <= 80;
      // Inline "3.1 Payment. Client pays..." -> heading "Payment".
      const lead = (m[2] || '').match(/^([^.]{2,40})\.\s/);
      const heading = titleOnly ? m[2] || `Section ${m[1]}` : lead ? lead[1] : firstWords(m[2] || rest.join(' '));
      const body = (titleOnly ? rest.join(' ') : [m[2], ...rest].join(' ')).replace(/\s+/g, ' ').trim();
      add(`§${m[1]}`, heading, body || m[2]);
    } else {
      para += 1;
      const anchor = kind === 'contract' ? `P${para}` : `${prefix}${para}`;
      add(anchor, firstWords(block), block.replace(/\s*\n\s*/g, ' ').trim());
    }
  }
  return sections.slice(0, MAX_SECTIONS);
}

/** Add a document to a dispute's evidence. `takenIds` are the doc ids already in its locker. */
function add(disputeId, { title, kind, text, source }, takenIds = []) {
  title = String(title || '').trim().slice(0, 120);
  kind = KINDS[kind] ? kind : 'other';
  if (!title) throw Object.assign(new Error('Give the document a name.'), { status: 400 });
  if (!String(text || '').trim()) throw Object.assign(new Error('The document is empty.'), { status: 400 });
  if (String(text).length > MAX_TEXT) throw Object.assign(new Error('That document is too long (200,000 characters max).'), { status: 400 });

  const sections = splitDocument(text, kind);
  const docs = list(disputeId);
  const doc = {
    id: makeId(title, new Set([...takenIds, ...docs.map((d) => d.id)])),
    title,
    kind,
    date: new Date().toISOString().slice(0, 10),
    source: String(source || '').trim().slice(0, 120) || KINDS[kind].label,
    summary: `${KINDS[kind].label} added by the freelancer, ${sections.length} sections.`,
    added: true,
    sections,
  };
  docs.push(doc);
  save(disputeId, docs);
  return doc;
}

function remove(disputeId, docId) {
  const docs = list(disputeId);
  const left = docs.filter((d) => d.id !== docId);
  if (left.length === docs.length) return false;
  save(disputeId, left);
  return true;
}

module.exports = { list, add, remove, splitDocument, KINDS };
