// Generic app tier: phoenix. The app comes from HAUNT_APP and HAUNT_APP_DIR.
import { defineGenericBot } from '../../../../packages/haunt/src/bot/generic';

export default defineGenericBot({ tier: 'phoenix', use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] });
