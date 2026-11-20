// Shared esbuild helper for the browser target. The SDK imports node:fs for its file journal; the browser
// never uses it (the page injects a journal store), so the node builtins resolve to an empty stub here.
import { build } from 'esbuild';

const stubNode = {
  name: 'stub-node-builtins',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: 'node-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'const f = () => { throw new Error("node builtin used in the browser"); }; export const closeSync = f, existsSync = f, fsyncSync = f, openSync = f, readFileSync = f, writeSync = f; export default {};',
      loader: 'js',
    }));
  },
};

/** Bundle one entry for the browser as an IIFE. Returns the code when `write` is false. */
export async function bundleBrowser(entry, { outfile, write = true } = {}) {
  const r = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    plugins: [stubNode],
    write,
    logLevel: 'warning',
  });
  return write ? null : r.outputFiles[0].text;
}
