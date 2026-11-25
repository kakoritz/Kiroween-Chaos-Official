// M0 safety net for the modular-engine work (.kiro/specs/modular-engine, R11). Pins today's per-app stage table, the
// fault-to-stage table and one seeded wave per app. The refactor phases M1 to M4 must keep this file unchanged and green.
// To regenerate on purpose: UPDATE_GOLDEN=1 npx vitest run packages/haunt/test/golden-apps.test.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS, laneTiers, type AppId } from '../src/shared/catalog';
import { FAULTS } from '../src/chaos/catalog';
import { assembleWave, assignSeq, BASE_TS, planWave } from '../../core/src/sim/wave';

const DIR = resolve(__dirname, 'golden');
const APP_IDS: AppId[] = ['orders', 'inbox', 'stream'];

function check(name: string, actual: unknown): void {
  const file = resolve(DIR, name);
  const text = JSON.stringify(actual, null, 1) + '\n';
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, text);
  expect(text, `${name} changed: the modular work must not change today's apps`).toBe(readFileSync(file, 'utf8'));
}

describe('golden: built-in apps stay the same through the modular refactor', () => {
  // covers: modular-engine/R1.5
  it('stage table per app (id, label, role, effects, durations)', () => {
    const table = Object.fromEntries(APP_IDS.map((a) => [a, APPS[a].stages.map((s) => ({ id: s.id, label: s.label, role: s.role, min: s.min, max: s.max, effects: s.effects.map((e) => `${e.kind}:${e.key}:${e.service}`) }))]));
    check('stages.json', table);
  });

  // covers: modular-engine/R2.3
  it('fault-to-stage table per app', () => {
    const table: Record<string, Record<string, string[]>> = {};
    for (const a of APP_IDS) {
      const ids = new Set(APPS[a].stages.map((s) => s.id));
      table[a] = Object.fromEntries(FAULTS.map((f) => [f.id, f.stages.filter((s) => ids.has(s))]).filter(([, v]) => (v as string[]).length > 0));
    }
    check('fault-stages.json', table);
  });

  // covers: modular-engine/R1.5
  it('one seeded wave per app gives the same event stream', () => {
    const out: Record<string, { events: number; sha256: string }> = {};
    for (const a of APP_IDS) {
      const spec = { app: a, tiers: laneTiers(5, 'race'), tiersMode: 'race' as const, orders: 4, seed: 7, pace: 1 as const };
      const events = assignSeq(assembleWave(planWave(spec), BASE_TS));
      out[a] = { events: events.length, sha256: createHash('sha256').update(JSON.stringify(events)).digest('hex') };
    }
    check('waves.json', out);
  });
});
