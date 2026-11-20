// Worker entry for the browser-target tests and the static page. Bundled for the browser by tools/browser-bundle.mjs.
import { connectWorkerBot } from '../../src/browser/worker-sdk';

const scope = (globalThis as { __haunt_scope?: never }).__haunt_scope ?? (globalThis as never);

connectWorkerBot(scope, {
  tier: 'phoenix',
  use: ['retry', 'journal', 'idempotency'],
  async run(sdk) {
    for (const id of ['ord-0001', 'ord-0002']) {
      await sdk.order(id, async (s) => {
        await s.stage('payment', async (st) => {
          await st.effect('charge', { key: st.key('charge'), body: { amount: 42 } });
        });
        await s.stage('confirmation', async (st) => {
          await st.effect('email', { key: st.key('email') });
        });
      });
    }
  },
});
