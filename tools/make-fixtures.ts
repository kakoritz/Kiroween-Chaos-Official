// npm run make:fixtures [--check]
// Generates contract/fixtures/*.jsonl from the storyboards (contract/STORYBOARDS.md) with the lane planner.
// --check compares against the committed files and exits 1 when they differ.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIXTURES } from '../packages/core/src/sim/fixtures';
import { findRepoRoot, formatViolations, validateEvents } from '../packages/haunt/src/contract/validate';

const root = findRepoRoot();
const dir = resolve(root, 'contract', 'fixtures');
const check = process.argv.includes('--check');
if (!check) mkdirSync(dir, { recursive: true });

let bad = 0;
for (const [name, build] of Object.entries(FIXTURES)) {
  const events = build();
  const violations = validateEvents(events);
  if (violations.length) {
    bad++;
    console.error(`${name}: ${violations.length} violation(s)\n${formatViolations(violations, 8)}`);
    continue;
  }
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const file = resolve(dir, `${name}.jsonl`);
  if (check) {
    const same = existsSync(file) && readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log(`${same ? 'ok     ' : 'STALE  '} ${name}.jsonl`);
    if (!same) bad++;
  } else {
    writeFileSync(file, text);
    const last = events[events.length - 1];
    console.log(`wrote ${name}.jsonl: ${events.length} events, ${((last.ts - events[0].ts) / 1000).toFixed(0)} s`);
  }
}
if (bad) process.exit(1);
