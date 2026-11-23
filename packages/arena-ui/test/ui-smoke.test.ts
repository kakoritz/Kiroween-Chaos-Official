// covers: PT-U13, TV3-U4
// UI smoke: play the hosted hero recording through the real model, lane ticker and arena scene with a stand-in canvas.
// It checks the same things a person would see: stage chips advance, the ticker says something per lane, the scene draws every
// frame without throwing, and the crew-lane styling and review card geometry hold. No browser, no network.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installHosted } from '../src/onboarding/hosted';
import { applyEvent, emptyVM, loadSnapshot } from '../src/arena/model';
import { LaneTickerModel } from '../src/arena/lanes-ticker';
import { ArenaScene, STAGE_W } from '../src/arena/scene';
import type { ArenaEvent } from '../src/api/types';

class FakePath { constructor(public d?: string) {} addPath(): void {} ellipse(): void {} roundRect(): void {} rect(): void {} arc(): void {} moveTo(): void {} lineTo(): void {} closePath(): void {} }
const chain = (): CanvasRenderingContext2D => {
  const fn: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'canvas' ? {} : k === 'measureText' ? () => ({ width: 40 }) : fn),
    set: () => true,
    apply: () => fn,
  });
  return fn as CanvasRenderingContext2D;
};
beforeAll(() => {
  (globalThis as Record<string, unknown>).Path2D = FakePath;
  (globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => chain() }) };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('arena UI smoke (PT-U13)', () => {
  it('plays a short wave: chips advance, the ticker speaks for every lane, the scene draws each frame', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const h = installHosted({} as never);
    const events: ArenaEvent[] = [];
    h.subscribe((e) => events.push(e));
    await h.startDemo('hero' as never);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.length).toBeGreaterThan(50);

    const vm = emptyVM();
    loadSnapshot(vm, await h.getState(), 0);
    const labelOf = (id: string): string => vm.stages.find((s) => s.id === id)?.label ?? id;
    const ticker = new LaneTickerModel(labelOf);
    const scene = new ArenaScene(chain());
    const seenChips = new Set<string>();
    let t = 0;
    events.forEach((ev, i) => {
      t += 50;
      applyEvent(vm, ev, t);
      ticker.push(ev, t);
      for (const l of vm.lanes) for (const c of l.chips) seenChips.add(c);
      if (i % 10 === 0) expect(() => scene.draw(vm, t)).not.toThrow();
    });
    expect(() => scene.draw(vm, t + 5000)).not.toThrow();

    expect(vm.lanes.length).toBeGreaterThanOrEqual(2);
    expect(vm.stages.length).toBeGreaterThan(2);
    expect(seenChips.has('done')).toBe(true);
    expect(seenChips.has('active')).toBe(true);
    const spoken = vm.lanes.filter((l) => ticker.row(l.lane).cur !== null);
    expect(spoken.length).toBe(vm.lanes.length);
    expect(vm.lanes.some((l) => l.counts.completed > 0)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('draws a campaign night (Crew lane plus ghosted rivals) without throwing', () => {
    const vm = emptyVM();
    vm.stages = ['a', 'b', 'c'].map((id) => ({ id, label: id, icon: 'x', workAnimation: 'read_mail' }));
    applyEvent(vm, { seq: 1, ts: 0, type: 'wave_start', wave: 1, detail: { lanes: 3, speed: 1 } } as ArenaEvent, 0);
    applyEvent(vm, { seq: 2, ts: 0, type: 'lane_ready', wave: 1, lane: 1, detail: { tier: 'crew', label: 'Your Crew', parts: ['retry', 'journal'] } } as ArenaEvent, 0);
    expect(vm.lanes[0]!.label).toBe('Your Crew');
    const scene = new ArenaScene(chain());
    expect(() => scene.draw(vm, 100)).not.toThrow();
    expect(scene.hot.some((r) => /gear parts/i.test(r.tip))).toBe(true);
  });
});

describe('review card size (TV3-U4)', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/arena/review-card.css', import.meta.url)), 'utf8');
  // The last .rc rule that sets a width wins (the file ends with the half-size override).
  const widths = [...css.matchAll(/\.rc \{[^}]*?\bwidth: (\d+)px/g)].map((m) => Number(m[1]));
  const width = widths[widths.length - 1]!;
  const maxH = Number(/\.rc \{[^}]*max-height: (\d+)px/.exec(css)![1]);
  const right = Number(/\.rc \{[^}]*\bright: (\d+)px/g.exec(css.slice(css.lastIndexOf('.rc { width')))?.[1] ?? /\.rc \{[^}]*\bright: (\d+)px/.exec(css)![1]);
  const DOOR_X = 1548;
  const ORDER_CARD_X = 1616;

  it('is about half the old star card: at most 180 by 90 px', () => {
    expect(width).toBeLessThanOrEqual(180);
    expect(width).toBeGreaterThanOrEqual(120);
    expect(maxH).toBeLessThanOrEqual(90);
  });
  it('sits over the ORDER n/m card and clear of the door', () => {
    const left = STAGE_W - right - width;
    expect(left).toBeGreaterThan(DOOR_X + 100);
    expect(left + width).toBeGreaterThan(ORDER_CARD_X);
    expect(left).toBeGreaterThanOrEqual(ORDER_CARD_X);
  });
});
