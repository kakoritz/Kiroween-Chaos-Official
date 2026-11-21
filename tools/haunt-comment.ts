// Writes the PR comment Markdown for the GitHub Action. Local file only; the Action posts it.
// Usage: node tools/run-ts.mjs tools/haunt-comment.ts <report.json> <out.md> [--badge-url u] [--run-url u] [--passed true|false]
import { readFileSync, writeFileSync } from 'node:fs';
import { renderPrComment } from '../packages/haunt/src/share/comment';

const [file, out, ...rest] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: haunt-comment <report.json> <out.md> [--badge-url u] [--run-url u] [--passed true|false]');
  process.exit(2);
}
const opt = (n: string): string | undefined => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const passed = opt('passed');
const md = renderPrComment(JSON.parse(readFileSync(file, 'utf8')), {
  badgeUrl: opt('badge-url') || undefined,
  runUrl: opt('run-url') || undefined,
  targetsPassed: passed === undefined || passed === '' ? undefined : passed === 'true',
});
writeFileSync(out, md);
console.log(`comment ${out}`);
