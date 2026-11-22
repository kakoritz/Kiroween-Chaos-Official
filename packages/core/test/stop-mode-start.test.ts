import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer, createLiveRuntime } from '../src/live';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

describe('stop, mode change, start', () => {
  for (const mode of ['off', 'manual', 'random']) {
    it(`a wave started after stop and mode=${mode} keeps running`, async () => {
      const rt = createLiveRuntime({
        botCommand: (lane) => ({ command: 'node', args: [lane] }),
        run: async (o) => {
          await new Promise<void>((r) => { const t = setTimeout(r, 400); o.signal!.addEventListener('abort', () => { clearTimeout(t); r(); }); });
          return { starts: 1, kills: [], exit: { code: o.signal!.aborted ? null : 0, signal: null }, clean: !o.signal!.aborted };
        },
      });
      srv = new LiveServer({ engine: rt.live, staticDir: '/nonexistent' });
      const { url } = await srv.listen(0);
      const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json() as any }; };
      expect((await post('/api/wave/start', { orders: 2, lanes: 2 })).status).toBe(200);
      expect((await post('/api/wave/stop')).status).toBe(200);
      expect((await post('/api/chaos/mode', { mode })).status).toBe(200);
      expect((await post('/api/wave/start', { orders: 2, lanes: 2 })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
      expect(srv.waves.active).toBe(true);
      await new Promise((r) => setTimeout(r, 600));
      expect(srv.waves.active).toBe(false);
    });
  }
});

describe('a finished wave whose travel queue is still draining', () => {
  it('does not end the next wave when stopped and restarted meanwhile', async () => {
    const gates: (() => void)[] = [];
    let runs = 0;
    const rt = createLiveRuntime({
      clock: false,
      sleep: () => new Promise<void>((r) => { gates.push(r); }),
      botCommand: (lane) => ({ command: 'node', args: [lane] }),
      run: async (o) => {
        const first = ++runs <= 1;
        if (first) {
          o.onEvent?.({ type: 'stage_start', order: 'ord-0001', stage: 'account', detail: { attempt: 1 } });
          o.onEvent?.({ type: 'stage_done', order: 'ord-0001', stage: 'account', detail: { ms: 5 } });
          o.onEvent?.({ type: 'stage_start', order: 'ord-0001', stage: 'create', detail: { attempt: 1 } });
          return { starts: 1, kills: [], exit: { code: 0, signal: null }, clean: true };
        }
        await new Promise<void>((r) => o.signal!.addEventListener('abort', () => r()));
        return { starts: 1, kills: [], exit: { code: null, signal: null }, clean: false };
      },
    });
    srv = new LiveServer({ engine: rt.live, staticDir: '/nonexistent' });
    const { url } = await srv.listen(0);
    const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json() as any }; };
    await post('/api/wave/start', { orders: 1, lanes: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(gates.length).toBeGreaterThan(0);
    expect(srv.waves.active).toBe(true);
    await post('/api/wave/stop');
    await post('/api/chaos/mode', { mode: 'off' });
    await post('/api/wave/start', { orders: 1, lanes: 1 });
    gates.splice(0).forEach((g) => g());
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.waves.active).toBe(true);
  });
});
