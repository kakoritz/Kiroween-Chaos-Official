// TV3-C4: POST /api/intensity and state.intensity on the live server and on the mock (V1_2 section 5).
import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer, type LiveEngine } from '../src/live';
import { createMockServer } from '../src/mock/server';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

async function boot(engine?: LiveEngine) {
  srv = new LiveServer({ engine, staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => {
    const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json() as any };
  };
  return { url, get, post };
}

describe('live server intensity endpoint', () => {
  it('state carries intensity, POST validates and emits the event', async () => {
    const { get, post } = await boot();
    expect((await get('/api/state')).body.intensity).toEqual({ level: 3, autoRamp: false, everyN: 4, max: 11 });
    for (const bad of [{ level: 0 }, { level: 12 }, { level: 2.5 }, { level: '5' }, {}, { level: 5, autoRamp: 'yes' }, { level: 5, everyN: 0 }]) {
      const r = await post('/api/intensity', bad);
      expect([r.status, r.body.error?.code]).toEqual([400, 'bad_request']);
    }
    const ok = await post('/api/intensity', { level: 11, autoRamp: true, everyN: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ level: 11, autoRamp: true });
    expect((await get('/api/state')).body.intensity).toMatchObject({ level: 11, autoRamp: true });
    const ev = srv!.log.events.find((x) => x.type === 'intensity')!;
    expect(ev).toMatchObject({ type: 'intensity', detail: { level: 11, source: 'player', autoRamp: true } });
    expect(ev.lane).toBeUndefined();
  });

  it('asks the engine to move the dial', async () => {
    const calls: unknown[] = [];
    const { post } = await boot({ setIntensity: (level, o) => { calls.push([level, o]); return { level, autoRamp: !!o?.autoRamp, everyN: 4, max: 11 }; } });
    await post('/api/intensity', { level: 7, autoRamp: true });
    expect(calls).toEqual([[7, { autoRamp: true }]]);
  });
});

describe('mock server intensity endpoint', () => {
  it('POST /api/intensity updates state.intensity and intensity-11 plays as a demo script', async () => {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try {
      const base = `http://127.0.0.1:${port}`;
      const post = (b: unknown) => fetch(`${base}/api/intensity`, { method: 'POST', body: JSON.stringify(b) });
      expect((await post({ level: 12 })).status).toBe(400);
      expect((await post({ level: 9, autoRamp: true })).status).toBe(200);
      const state = await (await fetch(`${base}/api/state`)).json() as any;
      expect(state.intensity).toMatchObject({ level: 9, autoRamp: true });
      expect((await fetch(`${base}/api/demo/start`, { method: 'POST', body: JSON.stringify({ script: 'intensity-11', speed: 4 }) })).status).toBe(200);
    } finally { await m.close(); }
  });
});
