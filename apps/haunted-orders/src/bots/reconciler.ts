// Tier: reconciler. retry + journal + idempotency: keys on every effect and a lookup before re-sending.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'reconciler', use: ['retry', 'journal', 'idempotency'], onWrongOrder: 'discount' });
