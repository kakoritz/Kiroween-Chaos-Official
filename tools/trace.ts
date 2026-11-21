// Traceability generator. Usage: node tools/run-ts.mjs tools/trace.ts [--check] [--out <file>]
// Scans .kiro/specs/** for requirement and task IDs, git log subjects for (#PR) numbers, and test files for
// "covers:" comments. Writes docs/TRACE.md. Local only: no network, git is read through the local repo.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { findRepoRoot } from '../packages/haunt/src/contract/validate';

export interface TraceItem {
  spec: string;
  id: string;
  kind: 'requirement' | 'task';
  text: string;
  status: string;
  prs: number[];
  tests: string[];
  refs?: string[];
}

const ID_RE = /^[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.haunt', 'coverage', '.vite', '__pycache__']);

function clip(s: string): string {
  const t = s.replace(/[`*_]/g, '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

/** Parse one spec markdown file into requirement and task items. */
export function parseSpec(spec: string, md: string): TraceItem[] {
  const out: TraceItem[] = [];
  let reqId: string | null = null;
  let inFence = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const task = /^\s*- \[([ xX~-])\]\s+\*\*(.+?)\*\*\s*(.*)$/.exec(line);
    if (task) {
      const inner = task[2]!.trim();
      const m = /^(\S+)\s*(.*)$/.exec(inner);
      const id = m![1]!.replace(/[.:]+$/, '');
      if (ID_RE.test(id)) {
        const text = `${m![2] ?? ''} ${task[3] ?? ''}`.trim();
        const refs = [...new Set(text.match(/\bR\d+(?:\.\d+)?\b/g) ?? [])];
        out.push({
          spec,
          id,
          kind: 'task',
          text: clip(text || inner),
          status: task[1] === ' ' ? 'open' : task[1] === '~' || task[1] === '-' ? 'partial' : 'done',
          prs: [],
          tests: [],
          refs,
        });
        continue;
      }
    }
    const head = /^#{2,4}\s+(R\d+(?:\.\d+)?)[.:]?\s*(.*)$/.exec(line);
    if (head) {
      reqId = head[1]!;
      out.push({ spec, id: reqId, kind: 'requirement', text: clip(head[2] ?? ''), status: 'n/a', prs: [], tests: [] });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      if (!/^#{2,4}\s+R\d/.test(line)) reqId = null;
      continue;
    }
    const num = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (num && reqId && !reqId.includes('.')) {
      out.push({ spec, id: `${reqId}.${num[1]}`, kind: 'requirement', text: clip(num[2]!), status: 'n/a', prs: [], tests: [] });
    }
  }
  return out;
}

/** Candidate IDs mentioned in a commit subject (whole tokens and dash prefixes). */
export function subjectIds(subject: string): Set<string> {
  const ids = new Set<string>();
  for (const tok of subject.split(/[^A-Za-z0-9.\-]+/)) {
    const t = tok.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!t) continue;
    ids.add(t);
    const parts = t.split('-');
    for (let i = 1; i < parts.length; i++) ids.add(parts.slice(0, i).join('-'));
  }
  return ids;
}

/** IDs named by "covers:" comments in a test source. */
export function coversIds(src: string): string[] {
  const ids: string[] = [];
  const re = /(?:\/\/|#|\*)\s*covers:\s*([^\n\r*]+)/gi;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    for (const t of m[1]!.split(/[\s,;]+/)) {
      const id = t.replace(/[.:]+$/, '');
      if (id && ID_RE.test(id)) ids.push(id);
    }
  }
  return ids;
}

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

const isTest = (p: string) => /\.test\.(ts|tsx|mjs|js)$/.test(p) || /(^|[\\/])test_[^\\/]+\.py$/.test(p) || /_test\.py$/.test(p);

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

export function repoWebBase(root: string): string | null {
  const url = git(root, ['remote', 'get-url', 'origin']).trim();
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  return m ? `https://github.com/${m[1]}` : null;
}

export function buildTrace(root: string): { items: TraceItem[]; md: string } {
  const specsDir = join(root, '.kiro', 'specs');
  const items: TraceItem[] = [];
  for (const f of walk(specsDir, (p) => p.endsWith('.md'))) {
    const rel = relative(specsDir, f).split(/[\\/]/);
    items.push(...parseSpec(rel[0]!, readFileSync(f, 'utf8')));
  }
  // De-duplicate repeated (spec,id,kind) rows, keeping the first.
  const seen = new Set<string>();
  const uniq = items.filter((i) => {
    const k = `${i.spec}\0${i.id}\0${i.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const byId = new Map<string, TraceItem[]>();
  for (const i of uniq) byId.set(i.id, [...(byId.get(i.id) ?? []), i]);

  const log = git(root, ['log', '--format=%s']);
  for (const subject of log.split(/\r?\n/)) {
    const pr = /\(#(\d+)\)\s*$/.exec(subject);
    if (!pr) continue;
    const n = Number(pr[1]);
    for (const id of subjectIds(subject)) for (const it of byId.get(id) ?? []) if (!it.prs.includes(n)) it.prs.push(n);
  }

  const testFiles = walk(root, isTest);
  for (const f of testFiles) {
    const rel = relative(root, f).replace(/\\/g, '/');
    for (const raw of coversIds(readFileSync(f, 'utf8'))) {
      // "spec/ID" qualifies a collision; a bare ID applies to every spec that has it.
      const [q, bare] = raw.includes('/') ? raw.split('/', 2) : [null, raw];
      for (const it of byId.get(bare!) ?? []) if ((!q || it.spec === q) && !it.tests.includes(rel)) it.tests.push(rel);
    }
  }
  // A task that names a requirement (R4 or R4.1) in its text passes its PRs and tests to that requirement.
  for (const t of uniq) {
    if (t.kind !== 'task' || !t.refs?.length) continue;
    for (const r of uniq) {
      if (r.kind !== 'requirement' || r.spec !== t.spec) continue;
      if (!t.refs.some((ref) => r.id === ref || r.id.startsWith(`${ref}.`))) continue;
      for (const n of t.prs) if (!r.prs.includes(n)) r.prs.push(n);
      for (const f of t.tests) if (!r.tests.includes(f)) r.tests.push(f);
    }
  }
  for (const i of uniq) {
    i.prs.sort((a, b) => a - b);
    i.tests.sort();
  }

  const base = repoWebBase(root);
  const prLink = (n: number) => (base ? `[#${n}](${base}/pull/${n})` : `#${n}`);
  const rows = (kind: TraceItem['kind']) =>
    uniq
      .filter((i) => i.kind === kind)
      .sort((a, b) => a.spec.localeCompare(b.spec) || a.id.localeCompare(b.id, 'en', { numeric: true }))
      .map(
        (i) =>
          `| ${i.id} | ${i.spec} | ${i.text} | ${i.status} | ${i.prs.map(prLink).join(', ') || '-'} | ${i.tests.map((t) => `\`${t}\``).join(', ') || '-'} |`,
      );
  const reqs = uniq.filter((i) => i.kind === 'requirement');
  const tasks = uniq.filter((i) => i.kind === 'task');
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');
  const header = '| ID | Spec | Text | Status | PRs | Tests |\n|---|---|---|---|---|---|';
  const md = [
    '# Traceability',
    '',
    'Generated by `npm run trace` (`tools/trace.ts`). Do not edit by hand. The hook `.kiro/hooks/trace-on-merge.kiro.hook` regenerates it when specs or tests change.',
    '',
    'Sources: requirement and task IDs from `.kiro/specs/**`, PR numbers from `git log` subjects ending in `(#N)`, tests from `// covers: <ID>` comments.',
    '',
    '## Coverage',
    '',
    `- Requirements: ${reqs.length}. With a PR: ${reqs.filter((i) => i.prs.length).length} (${pct(reqs.filter((i) => i.prs.length).length, reqs.length)}). With a test: ${reqs.filter((i) => i.tests.length).length} (${pct(reqs.filter((i) => i.tests.length).length, reqs.length)}).`,
    `- Tasks: ${tasks.length}. Done: ${tasks.filter((i) => i.status === 'done').length}. With a PR: ${tasks.filter((i) => i.prs.length).length} (${pct(tasks.filter((i) => i.prs.length).length, tasks.length)}). With a test: ${tasks.filter((i) => i.tests.length).length} (${pct(tasks.filter((i) => i.tests.length).length, tasks.length)}).`,
    `- Test files scanned: ${testFiles.length}.`,
    '',
    '## Tasks',
    '',
    header,
    ...rows('task'),
    '',
    '## Requirements',
    '',
    header,
    ...rows('requirement'),
    '',
  ].join('\n');
  return { items: uniq, md };
}

if (process.argv[1] && /trace(-[0-9a-f]{8})?\.(ts|mjs|js)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const args = process.argv.slice(2);
  const root = findRepoRoot();
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? resolve(args[oi + 1]!) : join(root, 'docs', 'TRACE.md');
  const { items, md } = buildTrace(root);
  if (args.includes('--check')) {
    const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (cur.replace(/\r\n/g, '\n') !== md) {
      console.error('docs/TRACE.md is stale: run npm run trace');
      process.exit(1);
    }
    console.log('docs/TRACE.md is current');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    console.log(`wrote ${relative(root, out)}: ${items.length} items`);
  }
}
