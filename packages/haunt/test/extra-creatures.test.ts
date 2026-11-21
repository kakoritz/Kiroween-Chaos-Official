import { describe, expect, it } from 'vitest';
import { CORE_CREATURES, CreatureRegistry, EXTRA_CREATURES, type ExtraContext } from '../src/creatures';
import { FAULTS } from '../src/chaos/catalog';

const base = (over: Partial<ExtraContext> = {}): ExtraContext => ({ rng: () => 0.5, lane: 'L1', stage: 'payment', ...over });
const by = (id: string) => EXTRA_CREATURES.find((c) => c.id === id)!;

describe('extra creatures', () => {
  it('core plus extra cover every catalog fault with a matching creature and family', () => {
    const r = new CreatureRegistry();
    for (const c of [...CORE_CREATURES, ...EXTRA_CREATURES]) r.register(c);
    expect(r.list()).toHaveLength(18);
    for (const f of FAULTS) {
      const c = r.forFault(f.id);
      expect(c?.id, f.id).toBe(f.creature);
      expect(c?.family, f.id).toBe(f.family);
    }
  });

  it('provider creatures post the right fault body', async () => {
    const posted: unknown[] = [];
    const ctx = base({ postFault: async (b) => { posted.push(b); } });
    await by('goblin').inject(ctx, 'http_429');
    await by('banshee').inject(ctx, 'internet_outage', { forMs: 8000 });
    await by('werewolf').inject(base({ stage: 'tracking', postFault: async (b) => { posted.push(b); } }), 'hazard_event');
    expect(posted).toEqual([
      { lane: 'L1', service: 'charge', mode: 'status', value: 429, count: 3, headers: { 'Retry-After': '2' } },
      { lane: 'L1', service: '*', mode: 'drop', forMs: 8000 },
      { lane: 'L1', service: 'tracking', mode: 'stall', value: 5000, forMs: 5000 },
    ]);
  });

  it('witch and mummy use their helpers and fail loudly without them', async () => {
    const calls: string[] = [];
    const ctx = base({ stage: 'intake', corruptInput: () => { calls.push('corrupt'); }, fillDisk: () => { calls.push('disk'); } });
    await by('witch').inject(ctx, 'malformed_payload');
    await by('mummy').inject(ctx, 'disk_full');
    expect(calls).toEqual(['corrupt', 'disk']);
    await expect(by('witch').inject(base(), 'malformed_payload')).rejects.toThrow(/corruptInput/);
    await expect(by('mummy').inject(base(), 'disk_full')).rejects.toThrow(/fillDisk/);
  });
});
