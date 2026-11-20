import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveRampRunner, runRamp } from '../src/ramp';

const work = mkdtempSync(join(tmpdir(), 'haunt-ramp-live-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Stand-in bot: handshake, then move every order file to done/ (or failed/ when FAIL_ALL is set).
const botJs = join(work, 'bot.mjs');
writeFileSync(botJs, `
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const root = process.env.HAUNT_DIR;
process.stdout.write(JSON.stringify({ k: 'ready' }) + '\\n');
createInterface({ input: process.stdin }).on('line', (l) => {
  if (JSON.parse(l).k !== 'go') return;
  for (const f of readdirSync(join(root, 'orders'))) {
    renameSync(join(root, 'orders', f), join(root, process.env.FAIL_ALL ? 'failed' : 'done', f));
  }
  process.exit(0);
});
`);

describe('live ramp runner', () => {
  it('runs every order across the concurrent lanes', async () => {
    const run = createLiveRampRunner({ command: process.execPath, args: [botJs], runDir: work });
    const r = await run(3, 10, 7);
    expect(r.latenciesMs).toHaveLength(10);
    expect(r.failed).toBe(0);
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it('counts orders in failed/ as failed', async () => {
    const run = createLiveRampRunner({ command: process.execPath, args: [botJs], runDir: work, env: { FAIL_ALL: '1' } });
    const r = await run(2, 6, 7);
    expect(r.latenciesMs).toHaveLength(0);
    expect(r.failed).toBe(6);
  });

  it('plugs into runRamp', async () => {
    const run = createLiveRampRunner({ command: process.execPath, args: [botJs], runDir: work });
    const report = await runRamp(run, { steps: [1, 2], ordersPerStep: 4, seed: 3 });
    expect(report.steps.map((s) => s.concurrency)).toEqual([1, 2]);
    expect(report.steps.every((s) => s.errorRate === 0)).toBe(true);
  });
});
