// Stream tier: reconciler.
import { defineStreamBot } from '../define';

export default defineStreamBot({ tier: 'reconciler', use: ['retry', 'journal', 'idempotency'] });
