// Full Pipeline + ChaosHost bot for the browser-target tests. Bundled for the browser by tools/browser-bundle.mjs.
import { connectPipelineBot } from '../../src/browser/worker-bot';

const scope = (globalThis as { __haunt_scope?: never }).__haunt_scope ?? (globalThis as never);

connectPipelineBot(scope, { tier: 'phoenix', use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'], seed: 'h63', orders: 2 });
