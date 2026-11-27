// covers: own attacks in haunt.yaml (third build list item 3). A named, tuned press of an existing fault on chosen stages.
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { RunnerEngine } from '../src/runner/engine';
import { parseHauntConfig } from '../src/config/haunt-config';
import { registerBundledApps } from '../src/config/bundled-apps';
import { attackById, attackFor, unregisterApp } from '../src/shared/registry';

const root = resolve(__dirname, '../../..');
afterEach(() => { unregisterApp('playback'); unregisterApp('coffee-shop'); });
const base = 'name: x\nstart: y\ntruth: http://127.0.0.1:7071\nstages:\n  - { id: pay, label: Pay, role: effect, effects: [{ kind: charge, key: c, idempotent: required }] }\n  - { id: tell, label: Tell, role: effect, effects: [{ kind: notify, key: n, idempotent: required }] }\n';

describe('attacks in the manifest', () => {
  it('parses a good list', () => {
    const r = parseHauntConfig(base + 'attacks:\n  - { id: card_declined, label: Card Decliner, base: http_500, stages: [pay], count: 4 }\n  - { id: rush, label: Rush, base: slow_link, stages: [pay, tell], forMs: 4000 }\n');
    expect(r.ok && r.config.attacks).toEqual([{ id: 'card_declined', label: 'Card Decliner', base: 'http_500', stages: ['pay'], count: 4 }, { id: 'rush', label: 'Rush', base: 'slow_link', stages: ['pay', 'tell'], forMs: 4000 }]);
  });
  it('names each mistake', () => {
    const bad = (line: string) => { const r = parseHauntConfig(base + `attacks:\n  - ${line}\n`); return r.ok ? '' : r.errors.join('\n'); };
    expect(bad('{ id: A!, label: X, base: http_500, stages: [pay] }')).toMatch(/id: lowercase/);
    expect(bad('{ id: a1, label: X, base: http_999, stages: [pay] }')).toMatch(/base: one of/);
    expect(bad('{ id: a1, label: X, base: http_500, stages: [nope] }')).toMatch(/"nope" is not a stage/);
    expect(bad('{ id: a1, label: X, base: http_500, stages: [pay], count: 50 }')).toMatch(/count: a whole number from 1 to 10/);
    expect(bad('{ id: a1, label: X, base: http_500, stages: [pay], count: 2, forMs: 500 }')).toMatch(/count or forMs, not both/);
    expect(bad('{ id: a1, label: X, base: http_500, stages: [pay], speed: 2 }')).toMatch(/speed/);
  });
});

describe('an attack in the engine', () => {
  const play = (stage: string, press: Record<string, unknown>) => {
    registerBundledApps(root);
    const events: { type: string; detail?: Record<string, unknown> }[] = [];
    const posted: Array<Record<string, unknown>> = [];
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage }), post: async (b) => { posted.push(b as never); } });
    engine.startWave(1, { orders: 3, seed: 7, tiers: 'race', lanes: 2, speed: 1, pace: 'normal', app: 'coffee-shop' } as never, (e) => events.push(e as never));
    engine.chaos({ lane: 1, ...press } as never);
    return { chaos: events.find((e) => e.type === 'chaos')!.detail!, posted };
  };
  it('pressing it by id arms its base fault with its count and shows its name', () => {
    registerBundledApps(root);
    expect(attackById('coffee-shop', 'card_declined')?.base).toBe('http_500');
    const { chaos, posted } = play('pay', { attack: 'card_declined' });
    expect(chaos.fault).toBe('http_500');
    expect(chaos.creatureName).toBe('Card Decliner');
    expect(posted.some((b) => b.value === 500 && b.count === 4)).toBe(true);
  });
  it('a plain press of the base fault on that stage meets the attack', () => {
    registerBundledApps(root);
    expect(attackFor('coffee-shop', 'pay', 'http_500')?.id).toBe('card_declined');
    expect(attackFor('coffee-shop', 'brew', 'http_500')).toBeUndefined();
    const { chaos, posted } = play('pay', { fault: 'http_500' });
    expect(chaos.creatureName).toBe('Card Decliner');
    expect(posted.some((b) => b.count === 4)).toBe(true);
  });
  it('a press that fixes its own count wins, and other stages are untouched', () => {
    const own = play('pay', { fault: 'http_500', count: 1 });
    expect(own.posted.some((b) => b.count === 1)).toBe(true);
    const other = play('brew', { fault: 'http_500' });
    expect(other.chaos.creatureName).toBeUndefined();
  });
  it('an unknown attack is refused', () => {
    registerBundledApps(root);
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'pay' }), post: async () => {} });
    engine.startWave(1, { orders: 3, seed: 7, tiers: 'race', lanes: 2, speed: 1, pace: 'normal', app: 'coffee-shop' } as never, () => {});
    expect(() => engine.chaos({ lane: 1, fault: 'http_500', attack: 'nope' } as never)).toThrow(/unknown attack/);
  });
});
