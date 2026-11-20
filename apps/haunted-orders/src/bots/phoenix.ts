// Tier: phoenix. all parts: circuit breaker, backoff and an offline queue for parked orders.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'phoenix', use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] });
