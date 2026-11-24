// Stream tier: phoenix.
import { defineStreamBot } from '../define';

export default defineStreamBot({ tier: 'phoenix', use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] });
