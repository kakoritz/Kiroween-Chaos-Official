import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live/server';
import { createSimEngine } from '../src/sim/engine';
import { partsOfPatch, policyLaneReliability } from '../../haunt/src/miner/improve';

async function improveOnce(seed: number, parts = true) {
  const dir = mkdtempSync(join(tmpdir(), 'det-'));
  const lessonsDir = join(dir, 'lessons');
  const engine = createSimEngine({ policyDir: lessonsDir });
  if (!parts) delete engine.setPartOverlay;
  const srv = new LiveServer({ engine, staticDir: '/nonexistent', lessonsDir, patternsFile: join(dir, 'p.json'), runDir: dir, specsDir: join(dir, 'specs') });
  const { url } = await srv.listen(0);
  await fetch(url + '/api/improve', { method: 'POST', body: JSON.stringify({ seed }) });
  let j: any;
  for (;;) { j = await (await fetch(url + '/api/improve')).json(); if (j.phase === 'done' || j.phase === 'error') break; await new Promise((r) => setTimeout(r, 20)); }
  const events = srv.log.events.slice();
  await srv.close();
  return Object.assign(j.report, { events, specsDir: join(dir, 'specs') });
}

describe('improve in virtual time', () => {
  it('gives the same grades and numbers for the same seed, and the policy improves the lanes that take it', async () => {
    const a = await improveOnce(11);
    const b = await improveOnce(11);
    const pick = (r: any) => ({ g: r.grade, rel: r.reliability, p: r.policyLanes, lost: r.lost, rep: r.repeats, sum: r.summary });
    expect(pick(a)).toEqual(pick(b));
    expect(a.policyLanes.reliability.after).toBeGreaterThan(a.policyLanes.reliability.before);
  }, 60_000);
  it.each([7, 23, 11])('reaches grade A on seed %i with simulated parts, the same twice, never applying the spec', async (seed) => {
    const a = await improveOnce(seed);
    const b = await improveOnce(seed);
    const pick = (r: any) => ({ g: r.grade, rel: r.reliability, p: r.policyLanes, lost: r.lost, rep: r.repeats, grants: r.partGrants });
    expect(pick(a)).toEqual(pick(b));
    expect(a.grade.after).toBe('A');
    expect(a.reliability.after).toBeGreaterThanOrEqual(90);
    expect(a.reliability.after).toBeGreaterThan(a.reliability.before);
    // The grants are simulated: a spec is still written for the parts and the report says so.
    expect(a.partGrants.length).toBeGreaterThan(0);
    expect(a.spec).not.toBeNull();
    expect(a.text).toContain('Simulated parts');
    // lane_ready keeps the tier and lists the parts only in the rerun (the second tournament).
    const ready = a.events.filter((e: any) => e.type === 'lane_ready');
    const ends = a.events.findIndex((e: any) => e.type === 'tournament_end');
    const lane1 = ready.filter((e: any) => e.lane === '1' || e.lane === 1);
    const first = lane1[0], last = lane1[lane1.length - 1];
    expect(first.detail.tier).toBe('rookie');
    expect(first.detail.parts).toEqual([]);
    expect(last.detail.tier).toBe('rookie');
    expect(last.detail.label).toBe('Rookie');
    expect(last.detail.parts.length).toBeGreaterThan(0);
    expect(ends).toBeGreaterThan(0);
    for (const g of a.partGrants) expect(g.added.length).toBeGreaterThan(0);
  }, 90_000);
  it('an engine without the part overlay grants nothing and every lane keeps its tier parts', async () => {
    const r = await improveOnce(7, false);
    expect(r.partGrants).toEqual([]);
    expect(r.text).not.toContain('Simulated parts');
    const lane1 = r.events.filter((e: any) => e.type === 'lane_ready' && String(e.lane) === '1');
    for (const e of lane1) expect(e.detail.parts).toEqual([]);
  }, 60_000);
  it('a part names the SDK parts it grants, and code-only patches grant none', () => {
    expect(partsOfPatch('retry')).toEqual(['retry']);
    expect(partsOfPatch('offline_queue')).toEqual(['breaker', 'offline_queue']);
    expect(partsOfPatch('timeout')).toEqual([]);
    expect(partsOfPatch('wrapper')).toEqual([]);
    expect(partsOfPatch(undefined)).toEqual([]);
  });
  it('policy-lane reliability skips the Rookie', () => {
    const r = policyLaneReliability({ orders: 20, ok: 10, repeats: 0, byLane: { 1: { orders: 10, ok: 0, repeats: 0 }, 3: { orders: 10, ok: 10, repeats: 0 } } });
    expect(r).toBe(100);
    expect(policyLaneReliability({ orders: 1, ok: 1, repeats: 0 })).toBeNull();
  });
});
