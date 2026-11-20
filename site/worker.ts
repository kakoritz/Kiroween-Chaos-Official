// Worker entry for the static page. Bundled for the browser by tools/build-browser.mjs.
import { connectWorkerBot } from '../packages/haunt/src/browser/worker-sdk';

connectWorkerBot(globalThis as never, {
  tier: 'phoenix',
  use: ['retry', 'journal', 'idempotency'],
  async run(sdk) {
    for (let n = 1; n <= 6; n++) {
      const id = `ord-${String(n).padStart(4, '0')}`;
      await sdk.order(id, async (s) => {
        await s.stage('payment', async (st) => {
          await st.work(300);
          await st.effect('charge', { key: st.key('charge'), body: { amount: 40 + n } });
        });
        await s.stage('confirmation', async (st) => {
          await st.effect('email', { key: st.key('email') });
        });
      });
    }
  },
});
