// Tier: rookie. no parts: no retries, no journal, no keys. A crash restarts from stage 1.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'rookie', use: [], onWrongOrder: 'refund' });
