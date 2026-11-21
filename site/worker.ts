// Worker entry for the static page. Bundled for the browser by tools/build-browser.mjs.
import { connectPipelineBot } from '../packages/haunt/src/browser/worker-bot';

connectPipelineBot(globalThis as never, {
  tier: 'phoenix',
  use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'],
  orders: 6,
});
