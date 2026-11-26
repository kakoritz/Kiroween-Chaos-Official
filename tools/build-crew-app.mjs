// `npm run build:crew-app`: bundles the MCP server into kiro-crew-app/server/haunt-mcp.mjs so the Crew app runs on its own
// (node server/haunt-mcp.mjs), with no repository checkout and no npm install. haunt_define, haunt_blocks, haunt_chain and haunt_lab
// work alone; haunt_sweep and haunt_ramp need HAUNT_ROOT (a checkout).
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'kiro-crew-app/server/haunt-mcp.mjs');
mkdirSync(resolve(root, 'kiro-crew-app/server'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'packages/core/src/bin/haunt-mcp.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json'),
  logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log(`built kiro-crew-app/server/haunt-mcp.mjs (${Math.round(statSync(out).size / 1024)} KB)`);

// The app page is the Chain Wizard itself (a static page: it runs in the browser, no server). Needs `npm run ui:build` first.
const dist = resolve(root, 'packages/arena-ui/dist');
if (!existsSync(resolve(dist, 'chain.html'))) { console.error('packages/arena-ui/dist/chain.html is missing. Run `npm run ui:build` first.'); process.exit(1); }
const page = resolve(root, 'kiro-crew-app/page');
rmSync(resolve(page, 'assets'), { recursive: true, force: true });
mkdirSync(resolve(page, 'assets'), { recursive: true });
const html = readFileSync(resolve(dist, 'chain.html'), 'utf8');
const todo = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((m) => m[1]);
const done = new Set();
while (todo.length) {
  const f = todo.pop();
  if (done.has(f)) continue;
  done.add(f);
  copyFileSync(resolve(dist, 'assets', f), resolve(page, 'assets', f));
  if (f.endsWith('.js')) for (const m of readFileSync(resolve(dist, 'assets', f), 'utf8').matchAll(/from\s*"\.\/([^"]+\.js)"|import\("\.\/([^"]+\.js)"\)/g)) todo.push(m[1] ?? m[2]);
}
// Inside Kiro Crew the page stands alone: the links to the other pages of the arena do not exist there.
writeFileSync(resolve(page, 'index.html'), html.replace(/<a href="\.\/workflow-lab\.html">Workflow Lab<\/a> <a href="\.\/hosted\.html">Back to the arena<\/a>/, '<span>Model-based what-if. The full game: github.com/kakoritz/Kiroween-Chaos-Official</span>'));
console.log(`built kiro-crew-app/page (Chain Wizard, ${done.size} asset files)`);
