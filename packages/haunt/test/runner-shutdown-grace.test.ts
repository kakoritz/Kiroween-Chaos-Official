// covers: tournament-stall/R1.2, tournament-stall/R1.3, tournament-stall/R1.4
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChaosDirector } from '../src/chaos';
import { runLane } from '../src/runner';

const work = mkdtempSync(join(tmpdir(), 'haunt-grace-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const script = (name: string, body: string): string => {
  const f = join(work, name);
  writeFileSync(f, body);
  return f;
};
const lane = () => { const d = new ChaosDirector(); d.addLane('L1', []); return d; };

describe('runLane ends when the bot does not', () => {
  it('R1.2 kills a bot that stays alive after shutdown, so the loop returns', async () => {
    const bot = script('hang.mjs', `
      process.stdout.write(JSON.stringify({ k: 'ready' }) + '\\n');
      process.stdin.on('data', (b) => {
        if (String(b).includes('"go"')) process.stdout.write(JSON.stringify({ k: 'idle' }) + '\\n');
      });
      setInterval(() => {}, 1000);`);
    const t0 = Date.now();
    const r = await runLane({ lane: 'L1', director: lane(), command: process.execPath, args: [bot], shutdownGraceMs: 300 });
    expect(r).toMatchObject({ starts: 1, clean: true });
    expect(r.exit.signal).toBe('SIGKILL');
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15000);

  it('R1.4 does not kill a bot that exits on shutdown inside the grace period', async () => {
    const bot = script('polite.mjs', `
      process.stdout.write(JSON.stringify({ k: 'ready' }) + '\\n');
      process.stdin.on('data', (b) => {
        const s = String(b);
        if (s.includes('"go"')) process.stdout.write(JSON.stringify({ k: 'idle' }) + '\\n');
        if (s.includes('shutdown')) process.exit(0);
      });`);
    const r = await runLane({ lane: 'L1', director: lane(), command: process.execPath, args: [bot], shutdownGraceMs: 5000 });
    expect(r).toMatchObject({ starts: 1, clean: true });
    expect(r.exit).toEqual({ code: 0, signal: null });
  }, 15000);

  it('R1.3 kills a bot that never says ready and rejects', async () => {
    const bot = script('mute.mjs', `setInterval(() => {}, 1000);`);
    await expect(runLane({ lane: 'L1', director: lane(), command: process.execPath, args: [bot], readyTimeoutMs: 300 })).rejects.toThrow(/ready/);
    // The child is gone: a second lane run on the same director still starts cleanly.
    const ok = script('ok.mjs', `
      process.stdout.write(JSON.stringify({ k: 'ready' }) + '\\n');
      process.stdin.on('data', (b) => { const s = String(b); if (s.includes('"go"')) process.exit(0); });`);
    const r = await runLane({ lane: 'L1', director: lane(), command: process.execPath, args: [ok] });
    expect(r.clean).toBe(true);
  }, 15000);
});
