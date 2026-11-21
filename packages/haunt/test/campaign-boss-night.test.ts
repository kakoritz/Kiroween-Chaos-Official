import { describe, expect, it } from 'vitest';
import { ALL_PARTS, allBossesRecovered, bossRecoveries, bossWindows, checkBossNight, loadCampaign, uncoveredBosses } from '../src/campaign';
import type { WaveEventLike } from '../src/campaign';

const { nights } = loadCampaign();
const night5 = nights.find((n) => n.id === 5)!;
const ev = (type: string, order?: string, lane = 1): WaveEventLike & { order?: string } => ({ type, lane, ...(order ? { order } : {}) });

// One in-flight order per boss, as the wave runner would have it.
const stream = (finish: boolean[]): WaveEventLike[] => {
  const out: WaveEventLike[] = [];
  finish.forEach((ok, i) => {
    const o = `ord-000${i + 1}`;
    out.push(ev('order_start', o), { type: 'boss_start' });
    if (ok) out.push(ev('order_done', o));
  });
  return out;
};

describe('night 5 boss plan (cp-night-5-boss)', () => {
  it('has the Lich, Banshee Queen and Headless Horseman in turn, each warned before it starts', () => {
    const w = bossWindows(night5);
    expect(w.map((x) => x.creature)).toEqual(['Lich', 'Banshee Queen', 'Headless Horseman']);
    expect(w.every((x) => x.warnAtMs < x.startAtMs)).toBe(true);
    expect(checkBossNight(night5)).toEqual([]);
  });

  it('acceptance 3: every boss window recovered', () => {
    expect(allBossesRecovered(night5, stream([true, true, true]))).toBe(true);
    expect(bossRecoveries(night5, stream([true, true, true])).map((r) => r.order)).toEqual(['ord-0001', 'ord-0002', 'ord-0003']);
  });

  it('a boss whose order never finishes is not recovered', () => {
    expect(allBossesRecovered(night5, stream([true, false, true]))).toBe(false);
    expect(bossRecoveries(night5, stream([true, false, true])).map((r) => r.recovered)).toEqual([true, false, true]);
  });

  it('ignores other lanes and an empty stream', () => {
    expect(allBossesRecovered(night5, [])).toBe(false);
    const other = stream([true, true, true]).map((e) => (e.type === 'boss_start' ? e : { ...e, lane: 2 }));
    expect(allBossesRecovered(night5, other)).toBe(false);
    expect(allBossesRecovered(night5, other, 2)).toBe(true);
  });

  it('only the full set of five parts covers every boss', () => {
    expect(uncoveredBosses(night5, ALL_PARTS)).toEqual([]);
    expect(uncoveredBosses(night5, []).length).toBe(3);
    expect(uncoveredBosses(night5, ['retry', 'breaker', 'offline_queue']).map((w) => w.creature)).toEqual(['Lich']);
  });
});
