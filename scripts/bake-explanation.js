// One-off: generate the plain-English explanation for a recorded replay's result and
// bake it in as `plainExplanation`, so judge mode (and anyone replaying that case) shows
// it immediately, already open, with no click and no live Groq call needed at judging time.
//
// Usage: node scripts/bake-explanation.js <replay-file> [--force]
// Skips replays that already have one baked in, so a re-run by habit doesn't spend
// Groq quota or silently replace copy someone may have reviewed. Pass --force to redo it.
const fs = require('fs');
const groq = require('../src/ai/groq');
const P = require('../src/agent/prompts');

async function main() {
  const file = process.argv[2];
  const force = process.argv.includes('--force');
  if (!file) throw new Error('Usage: node scripts/bake-explanation.js <replay-file> [--force]');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resultEvent = data.events.find((e) => e.type === 'result');
  if (!resultEvent) throw new Error('No result event in this replay');
  if (resultEvent.payload.plainExplanation && !force) {
    console.log(`${file} already has a baked explanation. Pass --force to regenerate it.`);
    return;
  }
  const { draft, diagnosis } = resultEvent.payload;

  const { data: out } = await groq.chatJSON({
    name: 'explain',
    schema: P.explainSchema,
    messages: [
      { role: 'system', content: P.SYSTEM },
      { role: 'user', content: P.explainPrompt({ claims: draft.claims, realComplaint: diagnosis.real_complaint.summary }) },
    ],
    maxTokens: 700,
    reasoningEffort: 'low',
  });

  resultEvent.payload.plainExplanation = out.paragraphs;
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(`Baked ${out.paragraphs.length} paragraphs into ${file}:`);
  out.paragraphs.forEach((p) => console.log(`  - ${p}`));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
