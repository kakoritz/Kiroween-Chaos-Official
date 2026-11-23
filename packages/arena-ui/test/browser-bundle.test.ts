// The arena-ui pages import engine code from packages/haunt and packages/core. None of it may pull a node module into the browser: bundling every
// page entry for the browser platform must resolve without a stub (vite.config.ts has none). If this fails, a node-only import (node:fs, node:path)
// reached a page: move the file access into a node-only file (journal-node, lessons-store, pattern-store, campaign/load, config/load).
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const entries = ['app/browser.ts', 'src/onboarding/hosted-entry.ts', 'app/main.ts', 'app/lab.ts', 'app/report.ts', 'app/workflow-lab.ts'];

describe('arena-ui browser bundle', () => {
  for (const e of entries) {
    it(`${e} bundles for the browser with no node module`, async () => {
      const r = await build({
        entryPoints: [resolve(ui, e)], bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent', metafile: true, loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty' },
        plugins: [{ name: 'raw', setup: (b) => { b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: a.path, namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, () => ({ contents: 'export default ""' })); } }],
        alias: { '@haunt/shared': resolve(ui, '../haunt/src/shared/index.ts') },
      });
      const inputs = Object.keys(r.metafile.inputs);
      expect(inputs.filter((i) => i.startsWith('node:'))).toEqual([]);
      expect(r.errors).toEqual([]);
    });
  }
});
