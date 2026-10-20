// Scores recorded agent runs against each scenario's answer key, without spending any AI tokens.
//   npm run eval
//
// For each dispute with a recorded run in data/replays/, it checks:
//   - evidence coverage: did the agent find and cite the key sections (answer_key.must_find)?
//   - strategy: did it pick the expected decision?
//   - grounding: what share of the final response's claims passed the citation check?
// The answer key is never shown to the model; it only exists for this script.
const fs = require('fs');
const path = require('path');
const { scenarios } = require('../src/cases');

const dir = path.join(__dirname, '..', 'data', 'replays');
let rows = 0;

for (const s of scenarios) {
  const file = path.join(dir, `${s.dispute.dispute_id}.json`);
  if (!fs.existsSync(file)) {
    console.log(`${s.id.padEnd(22)} (no recorded run)`);
    continue;
  }
  const { events } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = events.find((e) => e.type === 'result')?.payload;
  if (!result) continue;
  rows++;

  // Every section the agent cited anywhere: findings, hypotheses, proof plan, final claims.
  const cited = new Set();
  const add = (refs) => (refs || []).forEach((c) => cited.add(`${c.doc_id} ${c.anchor}`));
  result.findings.forEach((f) => add(f.citations));
  result.diagnosis.hypotheses.forEach((h) => add(h.supporting));
  result.strategy.proof_plan.forEach((p) => add(p.evidence));
  result.draft.claims.forEach((c) => add(c.citations));

  const found = s.answer_key.must_find.filter((ref) => cited.has(ref));
  const grounded = result.draft.claims.length;
  const total = grounded + (result.removed || []).length;

  console.log(
    `${s.id.padEnd(22)} evidence ${found.length}/${s.answer_key.must_find.length}` +
      `  strategy ${result.strategy.decision === s.answer_key.best_strategy ? '✓' : '✗'} ${result.strategy.decision.padEnd(26)}` +
      `  grounded ${grounded}/${total}  confidence ${result.diagnosis.real_complaint.confidence}%`
  );
  const missed = s.answer_key.must_find.filter((ref) => !cited.has(ref));
  if (missed.length) console.log(`${''.padEnd(22)} missed: ${missed.join(', ')}`);
  console.log(`${''.padEnd(22)} real complaint (agent): ${result.diagnosis.real_complaint.summary}`);
  console.log(`${''.padEnd(22)} real complaint (key):   ${s.answer_key.real_complaint}\n`);
}
if (!rows) console.log('\nNo recorded runs yet. Record one with: node scripts/run-one.js <dispute_id> --save');
