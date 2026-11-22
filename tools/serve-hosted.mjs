// Serves dist/hosted over http, the way GitHub Pages would, for a local check:
//   npm run build:hosted && node tools/serve-hosted.mjs [port] [--base=/Kiroween-Chaos/]
// --base mounts the site under a sub path (Pages serves a project site under /<repo>/). Unknown paths answer 404.html with status 404.
// Binds 127.0.0.1 only. Prints the URL.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist/hosted');
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 8080);
let base = args.find((a) => a.startsWith('--base='))?.slice(7) ?? '/';
if (!base.endsWith('/')) base += '/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.woff2': 'font/woff2' };

if (!existsSync(join(root, 'index.html'))) { console.error('dist/hosted is missing. Run `npm run build:hosted` first.'); process.exit(1); }

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = decodeURIComponent(url.pathname);
  const send404 = () => { res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(readFileSync(join(root, '404.html'))); };
  if (!p.startsWith(base)) return send404();
  p = p.slice(base.length);
  if (p === '' || p.endsWith('/')) p += 'index.html';
  const file = normalize(join(root, p));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return send404();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
server.listen(port, '127.0.0.1', () => console.log(`serving dist/hosted at http://127.0.0.1:${port}${base}`));
