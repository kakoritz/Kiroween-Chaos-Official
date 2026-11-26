// `npm run judge:check`: every claim in docs/JUDGE-CHECK.md must have evidence that exists (modular-engine R10.2).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const text = readFileSync(resolve(root, 'docs/JUDGE-CHECK.md'), 'utf8');
const scripts = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {}) as Record<string, string>;
const STATUS = ['Met', 'Partly', 'Gap'];

const rows = text.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Area') && !l.startsWith('|---'));
const problems: string[] = [];
const count: Record<string, number> = { Met: 0, Partly: 0, Gap: 0 };
for (const row of rows) {
  const c = row.split('|').slice(1, -1).map((x) => x.trim());
  const [area, claim, evidence, status, missing] = c;
  const tag = `${area}: ${claim}`;
  if (c.length < 5) { problems.push(`${tag}: row needs 5 columns`); continue; }
  if (!STATUS.includes(status!)) problems.push(`${tag}: status must be Met, Partly or Gap`);
  else count[status!]!++;
  if ((status === 'Partly' || status === 'Gap') && !missing) problems.push(`${tag}: a ${status} row must say what is missing`);
  const refs = [...evidence!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  if (refs.length === 0) problems.push(`${tag}: no evidence`);
  for (const ref of refs) {
    const run = /^npm run ([\w:-]+)/.exec(ref);
    if (run) { if (!scripts[run[1]!]) problems.push(`${tag}: no npm script "${run[1]}"`); }
    else if (!existsSync(resolve(root, ref))) problems.push(`${tag}: missing file ${ref}`);
  }
}
console.log(`judge:check ${rows.length} claims: ${count.Met} met, ${count.Partly} partly, ${count.Gap} gap`);
if (problems.length > 0) { console.error(problems.map((p) => `- ${p}`).join('\n')); process.exit(1); }
console.log('every claim has evidence that exists');
