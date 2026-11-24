// covers: PK-U1
import { describe, expect, it } from 'vitest';
import { loadPackChoices } from '../src/arena/packs';

describe('getPacks wiring', () => {
  it('uses the server list when GET /api/packs answers', async () => {
    const list = [{ id: 'streaming', title: 'Haunted Stream', modelBased: true, stages: [{ id: 'login', label: 'Login' }], faults: [{ id: 'buffering', stage: 'login', creature: 'Buffer Wraith' }], reviews: { label: 'Viewer rating' } }];
    const c = await loadPackChoices(async () => list);
    expect(c.map((x) => x.id)).toEqual(['streaming']);
    expect(c[0]!.creatures[0]!.name).toBe('Buffer Wraith');
  });

  it('falls back to the bundled packs when the endpoint fails', async () => {
    const c = await loadPackChoices(async () => { throw new Error('404'); });
    expect(c.map((x) => x.id)).toContain('streaming');
  });
});
