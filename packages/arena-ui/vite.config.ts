import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The UI always calls same-origin /api/* so it has no mode-specific code.
// In dev and preview, Vite forwards /api and /_mock to the core server (mock or live).
const core = { target: 'http://127.0.0.1:7070', changeOrigin: false };
const proxy = { '/api': core, '/_mock': core };

// The haunt browser sources import no node module: the file journal, the lessons and pattern stores, the campaign loader and the config loader live in
// node-only files (journal-node, lessons-store, pattern-store, campaign/load, config/load) that the page never imports, so no stub is needed.
export default defineConfig({
  resolve: { alias: { '@haunt/shared': resolve(__dirname, '../haunt/src/shared/index.ts') } },
  worker: { format: 'es' },
  base: './',
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 4173, proxy },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'lab.html'), report: resolve(__dirname, 'report.html'), browser: resolve(__dirname, 'browser.html'), hosted: resolve(__dirname, 'hosted.html'), workflowLab: resolve(__dirname, 'workflow-lab.html') } } },
});


