// Assembles the hosted demo into dist/hosted from the arena UI build (run `npm run ui:build` first).
// Build only: it never publishes anything and never enables GitHub Pages.
// Checks: total size under 2 MB, an index.html entry, and no external request (script, stylesheet, image, fetch, url()).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = resolve(root, 'packages/arena-ui/dist');
const out = resolve(root, 'dist/hosted');
const MAX_BYTES = 2 * 1024 * 1024;

if (!existsSync(join(src, 'hosted.html'))) {
  console.error('packages/arena-ui/dist/hosted.html is missing. Run `npm run ui:build` first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
copyFileSync(join(src, 'hosted.html'), join(out, 'index.html'));
writeFileSync(join(out, '.nojekyll'), '');

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = walk(out);
const total = files.reduce((a, f) => a + statSync(f).size, 0);

// External requests. A plain <a href> link is navigation, not a request, and is allowed.
const EXTERNAL = [
  /<script[^>]+src=["']?(?:https?:)?\/\//i,
  /<link[^>]+href=["']?(?:https?:)?\/\//i,
  /<img[^>]+src=["']?(?:https?:)?\/\//i,
  /\bfetch\(\s*["'`]https?:/i,
  /\bnew\s+(?:EventSource|WebSocket|XMLHttpRequest)\b[^;]{0,40}["'`](?:https?|wss?):/i,
  /\burl\(\s*["']?(?:https?:)?\/\//i,
  /@import\s+["']?https?:/i,
];
const bad = [];
for (const f of files.filter((x) => /\.(html|js|css)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const re of EXTERNAL) if (re.test(text)) bad.push(`${f.slice(out.length + 1)}: ${re}`);
}

console.log(`built dist/hosted: ${files.length} files, ${(total / 1024).toFixed(0)} KB`);
if (total > MAX_BYTES) { console.error(`bundle is ${total} bytes, limit ${MAX_BYTES}`); process.exit(1); }
if (bad.length) { console.error(`external requests found:\n${bad.join('\n')}`); process.exit(1); }
