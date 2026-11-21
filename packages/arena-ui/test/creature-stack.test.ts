import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, type ArenaVM } from '../src/arena/model';
import { captionOf, creatureFrame, shown, spriteOf } from '../src/arena/creatures';
import type { ArenaEvent } from '../src/api/types';

const stages = ['intake', 'account', 'payment'].map((id) => ({ id, label: id, icon: 'x', workAnimation: 'read_mail' }));
const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, lane: 1, ...extra });
const chaos = (creature: string, fault: string, depth: number, more: Record<string, unknown> = {}): ArenaEvent =>
  ev('chaos', { stage: 'account', detail: { creature, fault, scope: 'outer', depth, injectedAt: 'stage', source: 'user', ...more } });

const start = (): ArenaVM => {
  const vm = emptyVM(); vm.stages = stages;
  applyEvent(vm, { seq: 0, ts: 0, type: 'wave_start', wave: 1, detail: { lanes: 1 } }, 0);
  applyEvent(vm, ev('order_start', { order: 'o1', detail: { index: 1, total: 1 } }), 0);
  applyEvent(vm, ev('stage_start', { stage: 'account', detail: { attempt: 1 } }), 0);
  return vm;
};

describe('creature stack (UI-B3)', () => {
  it('adds one creature per chaos, newest last, and the depth badge follows', () => {
    const vm = start();
    applyEvent(vm, chaos('zombie', 'timeout', 1), 100);
    applyEvent(vm, chaos('ghost', 'http_404', 2), 200);
    const l = vm.lanes[0]!;
    expect(l.depth).toBe(2);
    expect(shown(l, 300).map((c) => c.id)).toEqual(['zombie', 'ghost']);
  });

  it('shows at most five creatures', () => {
    const vm = start();
    for (let d = 1; d <= 5; d++) applyEvent(vm, chaos('ghost', 'http_404', d), d * 10);
    applyEvent(vm, chaos('zombie', 'timeout', 6), 100);
    expect(shown(vm.lanes[0]!, 120)).toHaveLength(5);
  });

  it('acts on the first consequence and exits last in, first out on recover_done', () => {
    const vm = start();
    applyEvent(vm, chaos('zombie', 'timeout', 1), 100);
    applyEvent(vm, chaos('ghost', 'http_404', 2), 200);
    const l = vm.lanes[0]!;
    expect(l.creatures.every((c) => c.actAt === null)).toBe(true);
    applyEvent(vm, ev('stage_fail', { stage: 'account', detail: { error: 'x' } }), 1000);
    expect(l.creatures.every((c) => c.actAt === 1000)).toBe(true);
    applyEvent(vm, ev('recover_done', { detail: { depth: 2, action: 'retry' } }), 2000);
    expect(l.creatures.find((c) => c.depth === 2)!.exitAt).toBe(2000);
    expect(l.creatures.find((c) => c.depth === 1)!.exitAt).toBeNull();
    expect(l.depth).toBe(1);
    expect(shown(l, 2000 + 301).map((c) => c.id)).toEqual(['zombie']);
  });

  it('keeps the killer on process_dead, puffs the rest in 200 ms, and clears all at process_up', () => {
    const vm = start();
    applyEvent(vm, chaos('zombie', 'timeout', 1), 100);
    applyEvent(vm, chaos('reaper', 'crash', 2), 200);
    applyEvent(vm, ev('process_dead', { detail: { restartInMs: 1000 } }), 300);
    const l = vm.lanes[0]!;
    const z = l.creatures.find((c) => c.id === 'zombie')!;
    const r = l.creatures.find((c) => c.id === 'reaper')!;
    expect(z.exitAt).toBe(300); expect(z.exitDur).toBe(200);
    expect(r.exitAt).toBeNull(); expect(r.actAt).toBe(300);
    applyEvent(vm, ev('process_up', {}), 1300);
    expect(r.exitAt).toBe(1300); expect(l.depth).toBe(0);
  });

  it('shrugs for 500 ms on chaos_absorbed, then leaves', () => {
    const vm = start();
    applyEvent(vm, chaos('poltergeist', 'duplicate_request', 1), 100);
    const c = vm.lanes[0]!.creatures[0]!;
    expect(c.actAt).toBe(400);
    applyEvent(vm, ev('chaos_absorbed', { detail: { creature: 'poltergeist', fault: 'duplicate_request', reason: 'processed twice' } }), 900);
    expect(c.shrug).toBe(true); expect(c.exitAt).toBe(1400);
  });

  it('exits on stage_done of its stage and on order_done', () => {
    const vm = start();
    applyEvent(vm, chaos('zombie', 'slow_link', 1), 100);
    applyEvent(vm, ev('stage_done', { stage: 'account', detail: {} }), 500);
    expect(vm.lanes[0]!.creatures[0]!.exitAt).toBe(500);
    applyEvent(vm, chaos('ghost', 'http_404', 1), 600);
    applyEvent(vm, ev('order_done', { detail: { clean: true } }), 700);
    expect(vm.lanes[0]!.creatures[1]!.exitAt).toBe(700);
  });

  it('marks inner, random and deferred creatures', () => {
    const vm = start();
    applyEvent(vm, chaos('ghost', 'http_404', 1, { scope: 'inner', source: 'random', deferred: true }), 100);
    const c = vm.lanes[0]!.creatures[0]!;
    expect(c.inner && c.random && c.deferred).toBe(true);
    expect(c.actAt).toBeNull();
  });

  it('prunes long-gone creatures', () => {
    const vm = start();
    applyEvent(vm, chaos('ghost', 'http_404', 1), 100);
    applyEvent(vm, ev('stage_done', { stage: 'account', detail: {} }), 200);
    applyEvent(vm, ev('stage_progress', { stage: 'account', detail: { pct: 10 } }), 9000);
    expect(vm.lanes[0]!.creatures).toHaveLength(0);
  });

  it('frames: enter takes 400 ms, act plays once, reduced motion skips travel, speed divides durations', () => {
    const vm = start();
    applyEvent(vm, chaos('reaper', 'crash', 1), 1000);
    const c = vm.lanes[0]!.creatures[0]!;
    expect(creatureFrame(c, 1200).enter).toBeCloseTo(0.5);
    expect(creatureFrame(c, 1200, 2).enter).toBe(1);
    expect(creatureFrame(c, 1200, 1, true).enter).toBe(1);
    expect(creatureFrame(c, 1500).anim).toBe('idle');
    c.actAt = 1500;
    const f = creatureFrame(c, 1950);
    expect(f.anim).toBe('swing'); expect(f.p).toBeCloseTo(0.5); expect(f.acted).toBe(true);
    expect(creatureFrame(c, 5000).p).toBe(1);
  });

  it('captions faults in plain words and falls back to a specter for unknown ids', () => {
    expect(captionOf('http_404')).toBe('404');
    expect(captionOf('missing_file')).toBe('MISSING FILE');
    expect(captionOf('some_new_fault')).toBe('SOME NEW FAULT');
    expect(spriteOf('lich')).toBe('lich');
    expect(spriteOf('banshee')).toBeNull();
    const vm = start();
    applyEvent(vm, chaos('banshee', 'internet_outage', 1), 0);
    expect(creatureFrame(vm.lanes[0]!.creatures[0]!, 100).anim).toBe('idle');
  });
});
