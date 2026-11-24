// covers: PK-C1, PK-U1
import { describe, expect, it } from 'vitest';
import { listPacks, parsePack, EMBEDDED_PACKS } from '../src/packs';

describe('pack listing and sprites', () => {
  it('lists every shipped pack with stages and creature names', () => {
    const ids = listPacks().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['streaming', 'ticketing']));
    const s = listPacks().find((p) => p.id === 'streaming')!;
    expect(s.faults.map((f) => f.creature)).toContain('Buffer Wraith');
    expect(s.stages.length).toBe(11);
  });

  it('streaming faults name their code-drawn sprite', () => {
    const s = listPacks().find((p) => p.id === 'streaming')!;
    expect(s.faults.find((f) => f.creature === 'CDN Kraken')?.sprite).toBe('cdn_kraken');
    expect(s.faults.find((f) => f.creature === 'Region Warden')?.sprite).toBe('region_ghost');
  });

  it('the validator rejects an unknown sprite id', () => {
    const bad = EMBEDDED_PACKS.streaming!.replace('sprite: buffer_wraith', 'sprite: nope');
    const r = parsePack(bad);
    expect(r.ok).toBe(false);
  });
});
