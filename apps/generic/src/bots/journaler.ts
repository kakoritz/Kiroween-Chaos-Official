// Generic app tier: journaler. The app comes from HAUNT_APP and HAUNT_APP_DIR.
import { defineGenericBot } from '../../../../packages/haunt/src/bot/generic';

export default defineGenericBot({ tier: 'journaler', use: ['retry', 'journal'] });
