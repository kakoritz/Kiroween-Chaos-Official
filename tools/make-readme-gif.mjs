// Regenerates docs/img/demo.gif, the looping demo clip at the top of README.md.
//   npm run build:hosted && node tools/make-readme-gif.mjs [--demo=hero] [--record=30] [--start=10] [--len=9] [--width=960] [--fps=8] [--colors=32]
// Serves dist/hosted on a spare loopback port, records it headless (python3 + playwright chromium, CHROME_NO_SANDBOX=1 if needed),
// then cuts --len seconds from --start and builds the GIF with ffmpeg (palette pass). No external network.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const opt = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const demo = opt('demo', 'hero'), record = opt('record', '30'), start = opt('start', '10'), len = opt('len', '9'), width = opt('width', '960'), fps = opt('fps', '8');
const out = resolve(root, 'docs/img/demo.gif');
if (!existsSync(join(root, 'dist/hosted/index.html'))) { console.error('Run `npm run build:hosted` first.'); process.exit(1); }
const port = 18700 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, [resolve(root, 'tools/serve-hosted.mjs'), String(port)], { stdio: 'ignore' });
const work = mkdtempSync(join(tmpdir(), 'readme-gif-'));
try {
  await new Promise((r) => setTimeout(r, 1000));
  mkdirSync(resolve(root, 'docs/img'), { recursive: true });
  const webm = join(work, 'demo.webm');
  const rec = spawnSync('python3', [resolve(root, 'tools/make-readme-gif.py'), `http://127.0.0.1:${port}/?demo=${demo}`, webm, record], { stdio: 'inherit' });
  if (rec.status !== 0) throw new Error('recording failed');
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  const pal = join(work, 'pal.png');
  const ff = (a) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed'); };
  ff(['-ss', start, '-t', len, '-i', webm, '-vf', `${vf},palettegen=max_colors=${opt('colors','32')}:stats_mode=diff`, pal]);
  ff(['-ss', start, '-t', len, '-i', webm, '-i', pal, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', out]);
  console.log(`wrote ${out} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
