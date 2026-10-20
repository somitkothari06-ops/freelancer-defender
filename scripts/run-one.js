// Run the agent on one dispute from the command line and print the reasoning trail.
//   node scripts/run-one.js PP-D-27140-HALDEN [--save]
// --save writes the full event stream to data/replays/<dispute_id>.json (used by "replay" mode).
const fs = require('fs');
const path = require('path');
const { loadCase } = require('../src/cases');
const { buildLocker } = require('../src/evidence/locker');
const { runDefender } = require('../src/agent/defender');

async function main() {
  const id = process.argv[2] || 'PP-D-27140-HALDEN';
  const save = process.argv.includes('--save');
  const c = await loadCase(id);
  const locker = buildLocker(c.scenario, { transactions: c.transactions, transactionsSource: c.sources.transactions });

  const events = [];
  const t0 = Date.now();
  const emit = (type, payload) => {
    events.push({ t: Date.now() - t0, type, payload });
    const p = payload || {};
    if (type === 'stage') console.log(`\n== ${p.stage} ${p.status}`, p.status === 'done' && p.data ? JSON.stringify(p.data, null, 1).slice(0, 2500) : '');
    else if (type === 'tool') console.log(`  > ${p.name} ${p.doc_id || p.query || ''}`);
    else if (type === 'finding') console.log(`  * FINDING: ${p.finding} [${p.citations.map((c) => c.doc_id + ' ' + c.anchor).join(', ')}]`);
    else if (type === 'pacing') console.log(`  ... waiting ${Math.round(p.ms / 1000)}s (${p.reason})`);
    else if (type === 'verify_issue') console.log('  ! verify issues:', JSON.stringify(p.failed, null, 1));
  };

  const result = await runDefender({ scenario: c.scenario, locker, sources: c.sources }, emit);
  console.log('\n== LETTER');
  result.package.letter.forEach((p) => console.log('- ' + p));
  console.log('\n== CLIENT MESSAGE\n' + result.package.clientMessage);
  console.log('\nusage', result.usage, `${Math.round((Date.now() - t0) / 1000)}s`);

  if (save) {
    const dir = path.join(__dirname, '..', 'data', 'replays');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ recorded_at: new Date().toISOString(), events }, null, 1));
    console.log('saved replay');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
