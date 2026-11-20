// Run id and report persistence. Spec: runtime.md section 10 (Runs, storage), tasks.md H4.2.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHtml, renderJson, renderMarkdown, type Report } from './builder';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Run id: run-<yyyymmdd-hhmmss>-<seed>, in UTC so equal inputs give equal ids. */
export function makeRunId(at: Date, seed: number): string {
  const d = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const t = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `run-${d}-${t}-${seed}`;
}

export interface WrittenReport {
  dir: string;
  json: string;
  html: string;
  markdown: string;
}

/** Write report.json, report.html and report.md under <root>/.haunt/runs/<run>/. */
export function writeReport(root: string, r: Report): WrittenReport {
  if (!/^run-[A-Za-z0-9._-]+$/.test(r.run)) throw new Error(`unsafe run id: ${r.run}`);
  const dir = join(root, '.haunt', 'runs', r.run);
  mkdirSync(dir, { recursive: true });
  const out: WrittenReport = {
    dir,
    json: join(dir, 'report.json'),
    html: join(dir, 'report.html'),
    markdown: join(dir, 'report.md'),
  };
  writeFileSync(out.json, renderJson(r));
  writeFileSync(out.html, renderHtml(r));
  writeFileSync(out.markdown, renderMarkdown(r));
  return out;
}
