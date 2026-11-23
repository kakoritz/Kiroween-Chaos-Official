import { describe, expect, it } from 'vitest';
import { createLiveRuntime } from '../src/live';

const S = { orders: 1, seed: 1, tiers: 'allPhoenix' as const, lanes: 1, speed: 1, pace: 'slow' as const, app: 'orders' as const };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Virtual clock: a travel sleep stays pending until the test releases it. */
function rig() {
  let clock = 0;
  const pending: { ms: number; go: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>((r) => pending.push({ ms, go: () => { clock += ms; r(); } }));
  const releaseAll = async () => { while (pending.length) { pending.shift()!.go(); await tick(); } await tick(); };
  return { now: () => clock, sleep, releaseAll, pending };
}

describe('a wave never ends because of the previous wave', () => {
  it('stop + start while the finished wave still drains its travel queue (cycled)', async () => {
    const t = rig();
    const finishing = async (o: any) => {
      for (const ev of [{ type: 'order_start', order: 'ord-0001' }, { type: 'order_done', order: 'ord-0001' }, { type: 'order_start', order: 'ord-0002' }]) o.onEvent?.(ev);
      return { restarts: 0 } as never;
    };
    const hanging = (o: any) => new Promise((r) => o.signal.addEventListener('abort', () => r({ restarts: 0 })));
    let wave = 0;
    const rt = createLiveRuntime({ clock: false, botCommand: () => ({ command: 'x', args: [] }), now: t.now, sleep: t.sleep, run: (o) => (wave === 1 || wave % 2 === 1 ? finishing(o) : hanging(o)) as never });
    for (let i = 0; i < 6; i++) {
      wave++;
      let ended = 0;
      rt.live.startWave!(wave, S, () => {}, () => { ended++; });
      await tick();
      // wave finishes by itself (odd) or hangs (even); stop it, start the next, then let the old queue drain
      if (wave % 2 === 1) {
        expect(t.pending.length).toBeGreaterThan(0);
        rt.live.stopWave!();
        wave++;
        let ended2 = 0;
        rt.live.startWave!(wave, S, () => {}, () => { ended2++; });
        await t.releaseAll();
        expect(ended).toBe(0);
        expect(ended2).toBe(0);
        rt.live.stopWave!();
      } else {
        rt.live.stopWave!();
        await t.releaseAll();
      }
    }
  });

  it('a wave that really finishes still ends once', async () => {
    const t = rig();
    const rt = createLiveRuntime({ clock: false, botCommand: () => ({ command: 'x', args: [] }), now: t.now, sleep: t.sleep, run: (async (o: any) => { o.onEvent?.({ type: 'order_start', order: 'ord-0001' }); return { restarts: 0 }; }) as never });
    let ended = 0;
    rt.live.startWave!(1, S, () => {}, () => { ended++; });
    await t.releaseAll();
    expect(ended).toBe(1);
  });
});
