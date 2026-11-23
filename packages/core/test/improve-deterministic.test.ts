import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live/server';
import { createSimEngine } from '../src/sim/engine';
import { policyLaneReliability } from '../../haunt/src/miner/improve';

async function improveOnce(seed: number) {
  const dir = mkdtempSync(join(tmpdir(), 'det-'));
  const lessonsDir = join(dir, 'lessons');
  const srv = new LiveServer({ engine: createSimEngine({ policyDir: lessonsDir }), staticDir: '/nonexistent', lessonsDir, patternsFile: join(dir, 'p.json'), runDir: dir, specsDir: join(dir, 'specs') });
  const { url } = await srv.listen(0);
  await fetch(url + '/api/improve', { method: 'POST', body: JSON.stringify({ seed }) });
  let j: any;
  for (;;) { j = await (await fetch(url + '/api/improve')).json(); if (j.phase === 'done' || j.phase === 'error') break; await new Promise((r) => setTimeout(r, 20)); }
  await srv.close();
  return j.report;
}

describe('improve in virtual time', () => {
  it('gives the same grades and numbers for the same seed, and the policy improves the lanes that take it', async () => {
    const a = await improveOnce(11);
    const b = await improveOnce(11);
    const pick = (r: any) => ({ g: r.grade, rel: r.reliability, p: r.policyLanes, lost: r.lost, rep: r.repeats, sum: r.summary });
    expect(pick(a)).toEqual(pick(b));
    expect(a.policyLanes.reliability.after).toBeGreaterThan(a.policyLanes.reliability.before);
  }, 60_000);
  it('policy-lane reliability skips the Rookie', () => {
    const r = policyLaneReliability({ orders: 20, ok: 10, repeats: 0, byLane: { 1: { orders: 10, ok: 0, repeats: 0 }, 3: { orders: 10, ok: 10, repeats: 0 } } });
    expect(r).toBe(100);
    expect(policyLaneReliability({ orders: 1, ok: 1, repeats: 0 })).toBeNull();
  });
});
