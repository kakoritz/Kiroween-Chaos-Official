// Pins that every enemy the engine can send is drawn, and drawn on the lane at the stage it hit. Pure: no DOM, no clock.
import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, stationX, type ArenaVM } from '../src/arena/model';
import { creatureFrame, creatureSlots, shown, spriteOf, TRACK_X0, CREATURE_X1 } from '../src/arena/creatures';
import { isWorld } from '../src/arena/world-events';
import { streamingId } from '../src/creatures/streaming-defs';
import { CREATURES as CATALOG } from '../../core/src/live/catalog';
import { APP_STAGES } from '../../core/src/live/catalog';
import { DEFAULT_ROUNDS, roundPlan } from '../../haunt/src/tournament/rounds';
import { intensityRow } from '../../haunt/src/runner/intensity';
import { EMBEDDED_PACKS } from '../../haunt/src/packs/embedded';
import { parsePack } from '../../haunt/src/packs/pack';
import { FAULTS } from '../../haunt/src/chaos/catalog';
import type { ArenaEvent } from '../src/api/types';

const drawable = (id: string): boolean => spriteOf(id) !== null || isWorld(id) || streamingId(id) !== null;

describe('every catalog creature has a sprite', () => {
  it('the catalog is not empty and has several kinds', () => {
    expect(CATALOG.length).toBeGreaterThan(15);
  });
  it.each(CATALOG.map((c) => [c.id]))('%s is drawn as itself, not as the generic specter', (id) => {
    expect(drawable(id!)).toBe(true);
  });
  it('every creature a fault can name is drawable', () => {
    const missing = FAULTS.map((f) => f.creature).filter((c) => !drawable(c));
    expect(missing).toEqual([]);
  });
  it('every fault of every embedded pack resolves to a sprite (art, or the pack sprite)', () => {
    const missing: string[] = [];
    for (const [id, text] of Object.entries(EMBEDDED_PACKS)) {
      const r = parsePack(text);
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      for (const f of r.pack.faults) {
        const ok = f.sprite ? streamingId(f.sprite) !== null : spriteOf(f.art) !== null;
        if (!ok) missing.push(`${id}/${f.id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, lane: 1, ...extra });

function laneWith(stages: string[], lanes: number): ArenaVM {
  const vm = emptyVM();
  vm.stages = stages.map((id) => ({ id, label: id, icon: 'x', workAnimation: 'read_mail' }));
  applyEvent(vm, { seq: 0, ts: 0, type: 'wave_start', wave: 1, detail: { lanes } }, 0);
  return vm;
}

describe('creatures appear on every lane at the stage they hit', () => {
  for (const app of ['orders', 'inbox'] as const) {
    const stages = APP_STAGES[app].map((s) => s.id);
    it(`${app}: one creature per lane for every stage, inside the track, beside the skeleton`, () => {
      const vm = laneWith(stages, 5);
      stages.forEach((stage, i) => {
        for (let lane = 1; lane <= 5; lane++) {
          applyEvent(vm, ev('chaos', { lane, stage, detail: { creature: 'zombie', fault: 'timeout', scope: 'outer', depth: 1, injectedAt: 'stage', source: 'demo' } }), 10 + i);
          const l = vm.lanes.find((x) => x.lane === lane)!;
          const list = shown(l, 11 + i);
          expect(list.some((c) => c.stage === stage), `lane ${lane} ${stage}`).toBe(true);
          const skelX = stationX(i, stages.length);
          const { xs } = creatureSlots(list.length, skelX);
          for (const x of xs) { expect(x).toBeGreaterThanOrEqual(TRACK_X0 + 40); expect(x).toBeLessThanOrEqual(CREATURE_X1); }
          const mine = xs[list.length - 1]!;
          expect(mine, `${stage} slot follows its station`).toBeGreaterThanOrEqual(Math.min(skelX, CREATURE_X1 - 56 * (list.length - 1)));
          l.creatures = [];
        }
      });
    });
  }

  it('a creature stack of five stays on the track at every station', () => {
    for (const n of [1, 2, 3, 4, 5]) for (let i = 0; i < 11; i++) {
      const { xs } = creatureSlots(n, stationX(i, 11));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(TRACK_X0 + 40);
      expect(Math.max(...xs)).toBeLessThanOrEqual(CREATURE_X1);
    }
  });
});

describe('engine ids that differ from the art ids still animate', () => {
  it('will_o_wisp and headless_horseman use their own act animation, not idle', () => {
    for (const [id, anim] of [['will_o_wisp', 'lead'], ['headless_horseman', 'hurl']] as const) {
      const vm = laneWith(['a', 'b'], 1);
      applyEvent(vm, ev('chaos', { stage: 'a', detail: { creature: id, fault: 'crash', depth: 1 } }), 0);
      const c = vm.lanes[0]!.creatures[0]!;
      c.actAt = 0;
      expect(creatureFrame(c, 100).anim).toBe(anim);
    }
  });
});

describe('the round plan sends creatures to every lane (deterministic by seed)', () => {
  for (const seed of [7, 11, 2024]) {
    for (const [level, round] of [[3, 1], [9, 4]] as const) {
      it(`seed ${seed}: the plan of round ${round} is the same twice and names only drawable creatures`, () => {
        const cfg = DEFAULT_ROUNDS[round - 1]!;
        const a = roundPlan(seed, round, cfg);
        expect(roundPlan(seed, round, cfg)).toEqual(a);
        expect(cfg.intensity).toBe(level);
        expect(a.length).toBeGreaterThan(0);
        for (const p of a) expect(drawable(FAULTS.find((f) => f.id === p.fault)!.creature)).toBe(true);
      });
    }
  }
  it('the plan grows with the dial: levels 1 to 11 never give fewer presses than a lower level on average', () => {
    const size = (lvl: number): number => [1, 2, 3, 4, 5, 6].reduce((n, seed) => n + roundPlan(seed, 1, { lanes: 5, orders: 12, intensity: lvl }).length, 0);
    for (let lvl = 2; lvl <= 11; lvl++) expect(size(lvl)).toBeGreaterThanOrEqual(size(lvl - 1) - 6);
    expect(size(9)).toBeGreaterThan(size(1) * 2);
    expect(intensityRow(11).continuous).toBe(true);
  });
  it('a standard wave plan has more than one creature kind at default intensity and at 9 and 11', () => {
    for (const level of [3, 9, 11]) {
      const kinds = new Set<string>();
      for (const seed of [1, 2, 3]) for (const p of roundPlan(seed, 1, { lanes: 5, orders: 10, intensity: level })) kinds.add(FAULTS.find((f) => f.id === p.fault)!.creature);
      expect(kinds.size, `level ${level}`).toBeGreaterThan(2);
    }
  });
});
