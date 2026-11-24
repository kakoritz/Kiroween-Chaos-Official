// PK-U1 (Core side): GET /api/packs on the live and the mock server. Same body on both.
import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live';
import { createMockServer } from '../src/mock/server';
import { listPackSummaries } from '../../haunt/src/packs/summary';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

describe('GET /api/packs', () => {
  it('lists the streaming and ticketing packs with labels, stages and the model-based tag', () => {
    const packs = listPackSummaries();
    expect(packs.map((p) => p.id)).toEqual(['streaming', 'ticketing']);
    const t = packs.find((p) => p.id === 'ticketing')!;
    expect(t).toMatchObject({ title: 'Haunted Desk', app: 'inbox', modelBased: true, reviewLabel: 'Requester CSAT' });
    expect(t.stages).toHaveLength(11);
    expect(t.stages[0]).toEqual({ id: 'login', label: 'Login or SSO', kind: expect.any(String) });
    expect(packs.find((p) => p.id === 'streaming')!.app).toBeNull();
    for (const p of packs) { expect(p.faults).toBeGreaterThan(0); expect(Object.keys(p.creatures).length).toBeGreaterThan(0); }
  });

  it('is served by the live server', async () => {
    const srv = new LiveServer({ staticDir: '/nonexistent' });
    const { url } = await srv.listen(0);
    close = () => srv.close();
    const r = await fetch(`${url}/api/packs`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ packs: listPackSummaries() });
  });

  it('is served by the mock server with the same body', async () => {
    const mock = createMockServer({ port: 0 });
    const port = await mock.listen();
    close = () => mock.close();
    const r = await fetch(`http://127.0.0.1:${port}/api/packs`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ packs: listPackSummaries() });
  });
});
