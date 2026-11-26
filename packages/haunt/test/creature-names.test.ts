// An app can name its creatures; the arena shows the name. Spec: .kiro/specs/modular-engine (R6.2, M7 follow-up).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { RunnerEngine } from '../src/runner/engine';
import { registerAppFromDir } from '../src/config/register-dir';
import { registerBundledApps } from '../src/config/bundled-apps';
import { parseHauntConfig } from '../src/config/haunt-config';
import { creatureNameFor, unregisterApp } from '../src/shared/registry';
import { addCreature, chaosPhrase, creatureTip } from '../../arena-ui/src/arena/creatures';

const root = resolve(__dirname, '../../..');
afterEach(() => { unregisterApp('playback'); unregisterApp('coffee-shop'); unregisterApp('namey'); });

describe('creature names in the manifest', () => {
  it('parses creatures and refuses a bad stage or an empty list', () => {
    const base = 'name: x\nstart: y\ntruth: http://127.0.0.1:7071\nstages:\n  - { id: pay, label: Pay, role: effect, effects: [{ kind: charge, key: c, idempotent: required }] }\n';
    const ok = parseHauntConfig(base + 'creatures:\n  - { name: Till Troll, stage: pay, faults: [http_500] }\n');
    expect(ok.ok && ok.config.creatures).toEqual([{ name: 'Till Troll', stage: 'pay', faults: ['http_500'] }]);
    const bad = parseHauntConfig(base + 'creatures:\n  - { name: Ghost, stage: nope, faults: [] }\n');
    expect(!bad.ok && bad.errors.join()).toMatch(/faults: required list[\s\S]*stage: "nope" is not a stage/);
  });

  it('registering refuses a fault id the engine does not know, naming it', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'nm-'));
    writeFileSync(resolve(dir, 'haunt.yaml'), 'name: namey\nstart: y\ntruth: http://127.0.0.1:7071\nstages:\n  - { id: pay, label: Pay, role: effect, effects: [{ kind: charge, key: c, idempotent: required }] }\ncreatures:\n  - { name: Till Troll, faults: [http_999] }\n');
    const r = registerAppFromDir(dir);
    expect(!r.ok && r.errors.join()).toMatch(/unknown fault "http_999"/);
  });
});

describe('Haunted Playback gives the nine pack names to engine faults', () => {
  it('maps stage and fault to the pack creature', () => {
    registerBundledApps(root);
    const n = (stage: string, fault: string) => creatureNameFor('playback', stage, fault);
    expect(n('buffering', 'slow_link')).toBe('Buffer Wraith');
    expect(n('start_stream', 'timeout')).toBe('CDN Kraken');
    expect(n('license', 'http_404')).toBe('DRM Gatekeeper');
    expect(n('render', 'crash')).toBe('Render Gremlin');
    expect(n('entitlement', 'http_429')).toBe('Region Warden');
    expect(n('start_stream', 'crash')).toBe('Doppelganger');
    expect(n('finish', 'crash')).toBe('Poltergeist');
    expect(n('ads', 'internet_outage')).toBe('Cloud Banshee');
    expect(n('login', 'crash')).toBe('Reaper');
    expect(n('login', 'http_404')).toBeUndefined();
    expect(creatureNameFor('orders', 'payment', 'crash')).toBeUndefined();
    const names = new Set(['buffering:slow_link', 'start_stream:timeout', 'license:http_404', 'render:crash', 'entitlement:http_429', 'start_stream:crash', 'finish:crash', 'ads:internet_outage', 'login:crash'].map((k) => n(k.split(':')[0]!, k.split(':')[1]!)));
    expect(names.size).toBe(9);
  });

  it('the chaos event carries the name, and the arena shows it', () => {
    registerBundledApps(root);
    const events: { type: string; detail?: Record<string, unknown> }[] = [];
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'buffering' }), post: async () => {} });
    engine.startWave(1, { orders: 3, seed: 7, tiers: 'race', lanes: 2, speed: 1, pace: 'normal', app: 'playback' } as never, (e) => events.push(e as never));
    engine.chaos({ lane: 1, fault: 'slow_link' });
    const chaos = events.find((e) => e.type === 'chaos')!;
    expect(chaos.detail!.creatureName).toBe('Buffer Wraith');
    expect(chaos.detail!.creature).toBe('zombie');
    expect(chaosPhrase(chaos.detail!, 'Buffering and bitrate')).toBe('Buffer Wraith (slow link) hits Buffering and bitrate');
    const l = { creatures: [] as never[] };
    const c = addCreature(l as never, 0, chaos.detail!, 'buffering');
    expect(c.name).toBe('Buffer Wraith');
    expect(creatureTip(c)).toMatch(/^Buffer Wraith: slow link/);
  });

  it('an app with no names, and the built-in apps, show the engine name as before', () => {
    const events: { type: string; detail?: Record<string, unknown> }[] = [];
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'payment' }), post: async () => {} });
    engine.startWave(1, { orders: 3, seed: 7, tiers: 'race', lanes: 2, speed: 1, pace: 'normal', app: 'orders' } as never, (e) => events.push(e as never));
    engine.chaos({ lane: 1, fault: 'http_500' });
    const d = events.find((e) => e.type === 'chaos')!.detail!;
    expect(d.creatureName).toBeUndefined();
    expect(chaosPhrase(d, 'Payment')).toBe('http_500 hits Payment');
  });
});
