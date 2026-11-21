// Tier: retrier. retry only: three attempts, 500 ms apart. No memory across a crash.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'retrier', use: ['retry'], onWrongOrder: 'refund' });
