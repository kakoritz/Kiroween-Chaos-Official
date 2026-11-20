// Tier: rookie after the hardening fix (recorded, runtime.md section 32). The live `loop` runs this for lane 1 from wave 2.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'rookie', use: ['retry', 'journal', 'idempotency'] });
