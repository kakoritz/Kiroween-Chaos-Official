// Builds the static browser-target site into dist/site. Does not deploy or enable GitHub Pages.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './browser-bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist/site');
mkdirSync(out, { recursive: true });
await bundleBrowser(resolve(root, 'site/worker.ts'), { outfile: resolve(out, 'worker.js') });
await bundleBrowser(resolve(root, 'site/page.ts'), { outfile: resolve(out, 'page.js') });
copyFileSync(resolve(root, 'site/index.html'), resolve(out, 'index.html'));
console.log('built dist/site');
