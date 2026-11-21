// Tier: journaler. retry + journal: resumes from the journal after a crash. Still re-sends an unanswered effect.
import { defineBot } from '@haunt/bot';

export default defineBot({ tier: 'journaler', use: ['retry', 'journal'], onWrongOrder: 'discount' });
