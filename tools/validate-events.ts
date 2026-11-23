// npm run validate:events [files...]
// Checks contract fixtures against contract/events.schema.json and every ordering rule in contract/PROTOCOL.md.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { findRepoRoot, formatViolations, parseJsonl, validateEvents } from '../packages/haunt/src/contract/validate';

const root = findRepoRoot();
const json = process.argv.includes('--json');
let files = process.argv.slice(2).filter((a) => a !== '--json').map((f) => resolve(f));
if (files.length === 0) {
  const dir = resolve(root, 'contract', 'fixtures');
  files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => resolve(dir, f)) : [];
}

if (files.length === 0) {
  console.log('validate:events: no fixtures found (contract/fixtures/*.jsonl). Schema compiled fine.');
  validateEvents([{ seq: 1, ts: 1, type: 'hello', contractVersion: 1, mode: 'mock', app: 'orders' }], { requireWaveEnd: false });
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const events = parseJsonl(readFileSync(f, 'utf8'));
  const violations = validateEvents(events);
  if (json) { console.log(JSON.stringify({ violations })); if (violations.length) failed++; continue; }
  if (violations.length === 0) {
    console.log(`ok   ${basename(f)} (${events.length} events)`);
  } else {
    failed++;
    console.log(`FAIL ${basename(f)} (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
    console.log(formatViolations(violations));
  }
}
if (failed) {
  console.error(`validate:events: ${failed} of ${files.length} file(s) failed`);
  process.exit(1);
}
console.log(`validate:events: ${files.length} file(s) ok`);
