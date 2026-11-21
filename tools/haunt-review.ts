// Reviewer CLI. Usage: node tools/run-ts.mjs tools/haunt-review.ts <run-id> [--llm] [--events <file.jsonl>]
// Reads .haunt/runs/<run>/events.jsonl, writes postmortem.md and .kiro/specs/hardening-<run>/. Local files only.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseJsonl, findRepoRoot } from '../packages/haunt/src/contract/validate';
import { onWaveEnd } from '../packages/haunt/src/reviewer/hook';

const args = process.argv.slice(2);
const run = args.find((a) => !a.startsWith('--'));
if (!run) {
  console.error('usage: haunt-review <run-id> [--llm] [--events <file.jsonl>]');
  process.exit(2);
}
const ei = args.indexOf('--events');
const root = findRepoRoot();
const file = ei >= 0 ? resolve(args[ei + 1]!) : join(root, '.haunt', 'runs', run, 'events.jsonl');
if (!existsSync(file)) {
  console.error(`no events file: ${file}`);
  process.exit(2);
}
const events = parseJsonl(readFileSync(file, 'utf8')) as any[];
const r = await onWaveEnd(root, run, events, { llm: args.includes('--llm') });
if (!r) {
  console.log('wave has not ended (no wave_end event); nothing to review');
  process.exit(0);
}
console.log(`reviewer source: ${r.result.source}${r.result.fallbackReason ? ` (fallback: ${r.result.fallbackReason})` : ''}`);
console.log(`postmortem ${r.written.postmortem}`);
console.log(`spec ${r.written.specDir}`);
