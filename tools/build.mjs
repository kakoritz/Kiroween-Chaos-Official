// Builds the bundles that exist so far. CI runs this after typecheck and validate:events.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const targets = [{ entry: 'packages/core/src/bin/mock.ts', out: 'packages/core/dist/mock.js' }];
let built = 0;
for (const t of targets) {
  const entry = resolve(root, t.entry);
  if (!existsSync(entry)) {
    console.log(`skip ${t.entry} (not present yet)`);
    continue;
  }
  await build({
    entryPoints: [entry],
    outfile: resolve(root, t.out),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['ajv', 'ajv/*'],
    logLevel: 'warning',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  console.log(`built ${t.out}`);
  built++;
}
console.log(`build ok (${built} bundle${built === 1 ? '' : 's'})`);
