// Assembles the hosted demo into dist/hosted from the arena UI build (run by `npm run build:hosted`, which builds the UI first).
// Build only: it never publishes anything and never enables GitHub Pages.
// Output: index.html (the arena in browser mode), the Workflow Lab, lab, report, recorded runs, 404.html and .nojekyll.
// Checks: app under 2 MB, recorded runs under 6 MB, an index.html entry, and no external request (script, stylesheet, image, fetch, url()).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = resolve(root, 'packages/arena-ui/dist');
const out = resolve(root, 'dist/hosted');
const MAX_BYTES = 2 * 1024 * 1024; // the app itself
const MAX_RECORDED = 6 * 1024 * 1024; // recorded runs (JSON, served gzip by Pages)

if (!existsSync(join(src, 'hosted.html'))) {
  console.error('packages/arena-ui/dist/hosted.html is missing. Run `npm run ui:build` first.');
  process.exit(1);
}
if (!existsSync(resolve(root, 'site/recorded/tournament.json'))) {
  console.error('site/recorded is missing. Run `node tools/record-hosted.mjs` once.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
copyFileSync(join(src, 'hosted.html'), join(out, 'index.html'));
writeFileSync(join(out, '.nojekyll'), '');
// Recorded runs (tournament, improve loop, campaign data) from tools/record-hosted.mjs. The page fetches ./recorded/NAME.json.
cpSync(resolve(root, 'site/recorded'), join(out, 'recorded'), { recursive: true });
// 404 fallback: GitHub Pages serves it for any unknown path. Relative assets break at a deep path, so it links to the site root.
copyFileSync(resolve(root, 'site/404.html'), join(out, '404.html'));

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = walk(out);
const rel = (f) => f.slice(out.length + 1).replace(/\\/g, '/');
const sizeOf = (list) => list.reduce((a, f) => a + statSync(f).size, 0);
const total = sizeOf(files.filter((f) => !rel(f).startsWith('recorded/')));
const recTotal = sizeOf(files.filter((f) => rel(f).startsWith('recorded/')));

// External requests. A plain <a href> link is navigation, not a request, and is allowed.
const EXTERNAL = [
  /<script[^>]+src=["']?(?:https?:)?\/\//i,
  /<link[^>]+href=["']?(?:https?:)?\/\//i,
  /<img[^>]+src=["']?(?:https?:)?\/\//i,
  /\bfetch\(\s*["'`]https?:/i,
  /\bnew\s+(?:EventSource|WebSocket|XMLHttpRequest)\b[^;]{0,40}["'`](?:https?|wss?):/i,
  /@import\s+["']?https?:/i,
];
// CSS url() to another host: only meaningful in css and html (a JS bundle can hold new URL("http://...") strings, such as a URI parser).
const CSS_EXTERNAL = /\burl\(\s*["']?(?:https?:)?\/\//i;
const bad = [];
for (const f of files.filter((x) => /\.(html|js|css)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const re of EXTERNAL) if (re.test(text)) bad.push(`${rel(f)}: ${re}`);
  if (/\.(css|html)$/.test(f) && CSS_EXTERNAL.test(text)) bad.push(`${rel(f)}: ${CSS_EXTERNAL}`);
}

console.log(`built dist/hosted: ${files.length} files, app ${(total / 1024).toFixed(0)} KB, recorded ${(recTotal / 1024).toFixed(0)} KB`);
if (total > MAX_BYTES) { console.error(`bundle is ${total} bytes, limit ${MAX_BYTES}`); process.exit(1); }
if (recTotal > MAX_RECORDED) { console.error(`recorded runs are ${recTotal} bytes, limit ${MAX_RECORDED}`); process.exit(1); }
if (bad.length) { console.error(`external requests found:\n${bad.join('\n')}`); process.exit(1); }
