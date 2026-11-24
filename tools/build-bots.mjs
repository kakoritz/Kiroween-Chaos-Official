// Bundles every apps/haunted-orders/src/bots/<name>.ts into dist/bots/<name>.js (one self-contained file per bot).
// The runner spawns `node dist/bots/<tier>.js` directly (.kiro/specs/engine/runtime.md section 1).
import { build } from 'esbuild';
import { existsSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const botsDir = resolve(root, 'apps/haunted-orders/src/bots');
if (!existsSync(botsDir)) {
  console.error(`no bots folder at ${botsDir}`);
  process.exit(1);
}
const entries = readdirSync(botsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
if (entries.length === 0) {
  console.error('no bot files found');
  process.exit(1);
}
await build({
  entryPoints: entries.map((f) => resolve(botsDir, f)),
  outdir: resolve(root, 'dist/bots'),
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json'),
  logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
for (const f of entries) console.log(`built dist/bots/${basename(f, '.ts')}.js`);
// The Stream app's bots (stream-pack-app SP-C2) go to their own folder so tier names do not collide.
const streamDir = resolve(root, 'apps/haunted-stream/src/bots');
const streamEntries = existsSync(streamDir) ? readdirSync(streamDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort() : [];
if (streamEntries.length > 0) {
  await build({
    entryPoints: streamEntries.map((f) => resolve(streamDir, f)),
    outdir: resolve(root, 'dist/stream-bots'),
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfig: resolve(root, 'tsconfig.json'),
    logLevel: 'warning',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  for (const f of streamEntries) console.log(`built dist/stream-bots/${basename(f, '.ts')}.js`);
}
console.log(`build:bots ok (${entries.length + streamEntries.length} bots)`);
