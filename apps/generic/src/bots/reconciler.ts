// Generic app tier: reconciler. The app comes from HAUNT_APP and HAUNT_APP_DIR.
import { defineGenericBot } from '../../../../packages/haunt/src/bot/generic';

export default defineGenericBot({ tier: 'reconciler', use: ['retry', 'journal', 'idempotency'] });
