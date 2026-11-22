import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installHosted } from '../src/onboarding/hosted';
import { compressTs, segmentsByRound, segmentsByWave } from '../src/onboarding/recorded';

const rec = (n: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../site/recorded', n + '.json'), 'utf8'));
const loader = async (n: string) => rec(n);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('recorded runs (hosted demo)', () => {
  it('the recordings are real runs: a 4-round tournament and a three-phase improve loop', () => {
    const t = rec('tournament');
    expect(t.recorded).toBe(true);
    expect(t.events.filter((e: any) => e.type === 'round_start')).toHaveLength(4);
    expect(t.events.some((e: any) => e.type === 'tournament_end')).toBe(true);
    expect(segmentsByRound(t.events)).toHaveLength(4);
    const i = rec('improve');
    expect(i.final.phase).toBe('done');
    expect(segmentsByWave(i.events).length).toBeGreaterThanOrEqual(2);
    expect(rec('campaign').nights).toHaveLength(7);
  });

  it('compressTs caps long waits and keeps order', () => {
    const out = compressTs([{ type: 'a', ts: 1000 }, { type: 'b', ts: 1100 }, { type: 'c', ts: 90_000 }], 1200);
    expect(out.map((e) => e.ts)).toEqual([1000, 1100, 2300]);
  });

  it('plays the tournament round by round with Next, fills the Casebook, no network', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const h = installHosted({} as any, loader as never) as any;
    const types: string[] = [];
    h.subscribe((e: any) => types.push(e.type));
    expect(await h.getTournament()).toEqual({ phase: 'idle' });
    expect(await h.startTournament({})).toMatchObject({ tournament: true, round: 1 });
    await vi.advanceTimersByTimeAsync(400_000);
    expect(types).toContain('round_end');
    expect(types).toContain('awaiting_next');
    expect((await h.getTournament()).phase).toBe('awaiting_next');
    expect(((await h.getCasebook()).cases?.length ?? 0) + ((await h.getCasebook()).open?.length ?? 0)).toBeGreaterThan(0);
    await h.next();
    await vi.advanceTimersByTimeAsync(400_000);
    await h.next();
    await vi.advanceTimersByTimeAsync(400_000);
    await h.next();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(types).toContain('tournament_end');
    const done = await h.getTournament();
    expect(done.phase).toBe('done');
    expect(done.standings.length).toBeGreaterThan(0);
    await expect(h.next()).rejects.toMatchObject({ code: 'not_awaiting_next' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replays the improve loop and reports done with the compare report', async () => {
    vi.useFakeTimers();
    const h = installHosted({} as any, loader as never) as any;
    expect(await h.getImprove()).toEqual({ phase: 'idle' });
    await h.startImprove({});
    expect((await h.getImprove()).phase).toBe('before');
    await vi.advanceTimersByTimeAsync(900_000);
    const s = await h.getImprove();
    expect(s.phase).toBe('done');
    expect(s.report).toBeTruthy();
  });

  it('serves the campaign data and plays a campaign night', async () => {
    vi.useFakeTimers();
    const h = installHosted({} as any, loader as never) as any;
    expect((await h.getCampaign()).nights).toHaveLength(7);
    const r = await h.startWave({ campaign: { night: 1, parts: [] } });
    expect(r.wave).toBeGreaterThan(0);
    await expect(h.startWave({ campaign: { night: 99, parts: [] } })).rejects.toMatchObject({ code: 'wave_running' });
  });
});
