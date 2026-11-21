import { defineConfig } from 'vite';

// The UI always calls same-origin /api/* so it has no mode-specific code.
// In dev and preview, Vite forwards /api and /_mock to the core server (mock or live).
const core = { target: 'http://127.0.0.1:7070', changeOrigin: false };
const proxy = { '/api': core, '/_mock': core };

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 4173, proxy },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
