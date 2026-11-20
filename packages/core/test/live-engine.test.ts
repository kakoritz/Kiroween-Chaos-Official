import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live';
import { RunnerEngine } from '../../haunt/src/runner/engine';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

async function boot(engine: RunnerEngine) {
  srv = new LiveServer({ engine, staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const post = async (p: string, b?: unknown) => {
    const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json() as any };
  };
  return { post };
}

describe('RunnerEngine behind the live server', () => {
  it('registers lanes on wave start and arms a crash through the director', async () => {
    const engine = new RunnerEngine();
    const { post } = await boot(engine);
    expect((await post('/api/wave/start', { orders: 3, lanes: 2, seed: 1 })).status).toBe(200);
    expect(engine.lanes).toEqual(['1', '2']);
    srv!.waves.record({ type: 'order_start', lane: '1', order: 'o1', detail: { index: 1, total: 3 } });
    const r = await post('/api/chaos', { lane: 1, fault: 'crash' });
    expect(r.status).toBe(200);
    expect(r.body.depth).toBe(1);
    expect(engine.director.depth('1')).toBe(1);
    expect(srv!.log.events.some((e) => e.type === 'chaos' && e.lane === '1')).toBe(true);
  });

  it('applies speed and chaos mode', async () => {
    const engine = new RunnerEngine();
    const { post } = await boot(engine);
    await post('/api/wave/start', { orders: 2, lanes: 1 });
    await post('/api/speed', { speed: 4 });
    await post('/api/chaos/mode', { mode: 'random', frequency: 0.5, seed: 3 });
    expect(engine.speed).toBe(4);
    expect(engine.chaosMode).toEqual({ mode: 'random', frequency: 0.5, seed: 3 });
  });

  it('posts provider faults for non-process arms', async () => {
    const posted: unknown[] = [];
    const engine = new RunnerEngine({ post: async (b) => { posted.push(b); }, laneInfo: () => ({ state: 'working', stage: 'payment' }) });
    const { post } = await boot(engine);
    await post('/api/wave/start', { orders: 2, lanes: 1 });
    srv!.waves.record({ type: 'order_start', lane: '1', order: 'o1', detail: { index: 1, total: 2 } });
    const r = await post('/api/chaos', { lane: 1, fault: 'http_500' });
    expect(r.status).toBe(200);
    expect(posted).toHaveLength(1);
  });
});
