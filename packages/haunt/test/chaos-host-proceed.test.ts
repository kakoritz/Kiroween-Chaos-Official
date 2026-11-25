// covers: tournament-stall/R1.1
import { describe, expect, it } from 'vitest';
import { ChaosHost } from '../src/chaos/hooks';

const mk = (sent: Record<string, unknown>[]) =>
  new ChaosHost({ parts: [], now: () => 0, sleep: async () => {}, send: (m) => { sent.push(m); }, mode: 'child' });

describe('a bot at an armed hook does not wait forever', () => {
  it('R1.1 goes on when the runner answers proceed instead of killing it', async () => {
    const sent: Record<string, unknown>[] = [];
    const host = mk(sent);
    host.control({ k: 'arm', fault: 'crash', point: 'before_effect' });
    let done = false;
    const p = host.hook('before_effect', { order: 'ord-1', stage: 'account' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((m) => m.k)).toEqual(['at_point']);
    expect(done).toBe(false);
    host.release();
    await p;
    expect(done).toBe(true);
  });

  it('R1.1 a hook with nothing armed never blocks and sends nothing', async () => {
    const sent: Record<string, unknown>[] = [];
    await mk(sent).hook('mid_stage', { order: 'ord-1', stage: 'account' });
    expect(sent).toEqual([]);
  });
});
