// M0.3 size check for .kiro/specs/modular-engine: lists every source file that names a stage id as a string literal.
// Usage: node tools/stage-literals.mjs [--json]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git', 'docs', '.kiro']);
const STAGES = ['intake', 'account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'dispatch', 'updates', 'ship', 'tracking', 'transit', 'handoff', 'fetch', 'classify', 'ticket', 'draft', 'reply', 'archive', 'login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve', 'close'];
const RE = new RegExp(`['"\`](${STAGES.join('|')})['"\`]`, 'g');
const EXT = new Set(['.ts', '.mjs', '.py', '.css']);

const hits = new Map();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(extname(p))) {
      const n = (readFileSync(p, 'utf8').match(RE) ?? []).length;
      if (n) hits.set(relative(ROOT, p), n);
    }
  }
})(ROOT);

const group = (f) => (/(^|\/)(test|tests)\//.test(f) || /\.test\.(ts|mjs)$/.test(f) ? 'tests' : f.startsWith('packages/arena-ui') ? 'arena-ui' : f.startsWith('packages/haunt') ? 'haunt engine' : f.startsWith('packages/core') ? 'core' : f.startsWith('apps/') ? 'apps' : f.startsWith('tools') ? 'tools' : 'other');
const by = {};
for (const [f, n] of hits) { const g = group(f); (by[g] ??= { files: 0, literals: 0 }); by[g].files++; by[g].literals += n; }
if (process.argv.includes('--json')) console.log(JSON.stringify({ files: Object.fromEntries(hits), groups: by }, null, 1));
else {
  console.log('group          files  literals');
  for (const [g, v] of Object.entries(by).sort()) console.log(g.padEnd(14), String(v.files).padStart(5), String(v.literals).padStart(9));
  console.log(`total files: ${hits.size}`);
}
