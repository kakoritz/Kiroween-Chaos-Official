import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChaosDirector } from '../src/chaos';
import { runLane } from '../src/runner';
import type { Part } from '../src/sdk';

const work = mkdtempSync(join(tmpdir(), 'haunt-loop-'));
const botJs = join(work, 'bot.mjs');

describe('runner process loop', () => {
  beforeAll(async () => {
    await build({
      entryPoints: [fileURLToPath(new URL('./fixtures/chaos-bot.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', outfile: botJs, logLevel: 'silent',
    });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const marks = (dir: string) =>
    existsSync(join(dir, 'marks.log')) ? readFileSync(join(dir, 'marks.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')[1]!) : [];

  it('runs a bot with no chaos once and exits clean', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const d = new ChaosDirector();
    d.addLane('L1', ['retry', 'journal']);
    const r = await runLane({ lane: 'L1', director: d, command: process.execPath, args: [botJs], env: { HAUNT_DIR: dir, HAUNT_PARTS: 'retry,journal' } });
    expect(r).toMatchObject({ starts: 1, clean: true });
    expect(r.kills).toEqual([]);
    expect(marks(dir).at(-1)).toBe('done');
  }, 30000);

  it('kills at the armed point, waits the director delay, restarts and finishes', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const parts: Part[] = ['retry', 'journal'];
    const d = new ChaosDirector();
    d.addLane('L1', parts);
    d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, { state: 'working', stage: 'payment' });
    const sleeps: number[] = [];
    const r = await runLane({
      lane: 'L1', director: d, command: process.execPath, args: [botJs],
      env: { HAUNT_DIR: dir, HAUNT_PARTS: parts.join(',') },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(r).toMatchObject({ starts: 2, clean: true });
    expect(r.kills).toHaveLength(1);
    expect(sleeps).toEqual([1000]);
    expect(marks(dir)).toEqual(['started', 'call', 'started', 'call', 'effect_returned', 'done']);
  }, 30000);
});
