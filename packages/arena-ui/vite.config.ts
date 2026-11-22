import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The UI always calls same-origin /api/* so it has no mode-specific code.
// In dev and preview, Vite forwards /api and /_mock to the core server (mock or live).
const core = { target: 'http://127.0.0.1:7070', changeOrigin: false };
const proxy = { '/api': core, '/_mock': core };

// The haunt browser sources import node:fs for the file journal; the browser never calls it (the page injects a store).
const stubNode = {
  name: 'stub-node-builtins',
  enforce: 'pre' as const,
  resolveId: (id: string) => (/campaign\/nights$/.test(id) ? '\0nights-stub' : id === 'node:path' ? '\0node-path-stub' : id.startsWith('node:') ? '\0node-stub' : null),
  load: (id: string) => (id === '\0nights-stub'
    // campaign-fixtures calls loadCampaign() at module load (files plus Ajv). The hosted page passes the recorded campaign in, so this is an empty stand-in.
    ? 'export const loadCampaign = () => ({ nights: [], gear: [], start: { gear: [], credits: 0 } });'
    : id === '\0node-stub'
    ? 'const f = () => { throw new Error("node builtin used in the browser"); }; export const closeSync = f, existsSync = f, fsyncSync = f, openSync = f, readFileSync = f, writeSync = f, mkdirSync = f, readdirSync = f, rmSync = f, writeFileSync = f, statSync = f, appendFileSync = f, copyFileSync = f, renameSync = f, unlinkSync = f, readdirSync2 = f; export default {};'
    : id === '\0node-path-stub'
      // The tournament lessons store (packages/haunt) joins paths; the page never calls it.
      ? 'export const join = (...a) => a.join("/"), resolve = join, dirname = (p) => p.split("/").slice(0, -1).join("/"), basename = (p) => p.split("/").pop(), isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:/.test(p), relative = (a, b) => b, extname = (p) => { const m = /\.[^./]+$/.exec(p); return m ? m[0] : ""; }, normalize = (p) => p, sep = "/"; export default { join, resolve, dirname, basename, isAbsolute, relative, extname, normalize, sep };'
      : null),
};

export default defineConfig({
  plugins: [stubNode],
  resolve: { alias: { '@haunt/shared': resolve(__dirname, '../haunt/src/shared/index.ts') } },
  worker: { format: 'es', plugins: () => [stubNode] },
  base: './',
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 4173, proxy },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'lab.html'), report: resolve(__dirname, 'report.html'), browser: resolve(__dirname, 'browser.html'), hosted: resolve(__dirname, 'hosted.html'), workflowLab: resolve(__dirname, 'workflow-lab.html') } } },
});


