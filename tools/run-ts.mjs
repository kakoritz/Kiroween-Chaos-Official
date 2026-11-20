// Runs a TypeScript entry file under plain Node by bundling it with esbuild first.
// Usage: node tools/run-ts.mjs <entry.ts> [args...]
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node tools/run-ts.mjs <entry.ts> [args...]');
  process.exit(2);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(root, '.tmp', 'run');
mkdirSync(outDir, { recursive: true });
const id = createHash('sha1').update(resolve(entry)).digest('hex').slice(0, 8);
const outfile = resolve(outDir, `${basename(entry, '.ts')}-${id}.mjs`);
await build({
  entryPoints: [resolve(entry)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['ajv', 'ajv/*'],
  sourcemap: 'inline',
  logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
process.argv = [process.argv[0], outfile, ...args];
await import(pathToFileURL(outfile).href);

