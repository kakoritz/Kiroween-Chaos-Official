// npm run make:outcomes [--check]
// Writes packages/core/mock/outcomes.json (the outcome-template table, runtime.md section 15).
// --check compares against the committed file and exits 1 when it differs.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildOutcomeTable } from '../packages/core/src/mock/outcomes';
import { findRepoRoot } from '../packages/haunt/src/contract/validate';

const file = resolve(findRepoRoot(), 'packages', 'core', 'mock', 'outcomes.json');
const text = JSON.stringify(buildOutcomeTable(), null, 1) + '\n';

if (process.argv.includes('--check')) {
  const same = existsSync(file) && readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === text;
  console.log(`${same ? 'ok    ' : 'STALE '} outcomes.json`);
  if (!same) process.exit(1);
} else {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote outcomes.json: ${JSON.parse(text).length} rows`);
}
