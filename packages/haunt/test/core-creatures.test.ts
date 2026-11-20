import { describe, expect, it } from 'vitest';
import { CORE_CREATURES, CreatureRegistry, type CoreContext } from '../src/creatures';
import { FAULTS } from '../src/chaos/catalog';

const base = (over: Partial<CoreContext> = {}): CoreContext => ({ rng: () => 0.5, lane: 'L1', stage: 'payment', ...over });

describe('core creatures', () => {
  it('registers six creatures whose faults match the catalog', () => {
    const r = new CreatureRegistry();
    for (const c of CORE_CREATURES) r.register(c);
    expect(r.list().map((c) => c.id)).toEqual(['doppelganger', 'ghost', 'poltergeist', 'reaper', 'wraith', 'zombie']);
    for (const c of CORE_CREATURES) {
      for (const f of c.faults) {
        const def = FAULTS.find((d) => d.id === f);
        expect(def?.creature, f).toBe(c.id);
        expect(def?.family, f).toBe(c.family);
      }
    }
  });

  it('process creatures arm the runner', async () => {
    const armed: string[] = [];
    const ctx = base({ armProcess: (f) => { armed.push(f); } });
    await CORE_CREATURES.find((c) => c.id === 'reaper')!.inject(ctx, 'crash');
    await CORE_CREATURES.find((c) => c.id === 'wraith')!.inject(ctx, 'power_outage');
    expect(armed).toEqual(['crash', 'power_outage']);
  });

  it('provider creatures post the fault body for the stage', async () => {
    const posted: unknown[] = [];
    const ctx = base({ postFault: async (b) => { posted.push(b); } });
    await CORE_CREATURES.find((c) => c.id === 'zombie')!.inject(ctx, 'timeout');
    await CORE_CREATURES.find((c) => c.id === 'ghost')!.inject(ctx, 'http_404');
    expect(posted).toEqual([
      { lane: 'L1', service: 'charge', mode: 'latency', value: 3000, count: 1 },
      { lane: 'L1', service: 'charge', mode: 'status', value: 404, count: 2 },
    ]);
  });

  it('file creatures use the input helpers', async () => {
    const calls: string[] = [];
    const ctx = base({ stage: 'intake', input: { removeFile: () => { calls.push('remove'); }, duplicateFile: () => { calls.push('dup'); } } });
    await CORE_CREATURES.find((c) => c.id === 'poltergeist')!.inject(ctx, 'missing_file');
    await CORE_CREATURES.find((c) => c.id === 'doppelganger')!.inject(ctx, 'duplicate_request');
    expect(calls).toEqual(['remove', 'dup']);
  });

  it('missing context helpers fail loudly', async () => {
    await expect(CORE_CREATURES.find((c) => c.id === 'reaper')!.inject(base(), 'crash')).rejects.toThrow(/armProcess/);
  });
});
