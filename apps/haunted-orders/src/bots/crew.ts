// Campaign Crew (lane 1 of a night). The parts the player equipped come from HAUNT_PARTS; see packages/haunt/src/campaign/crew.ts.
import { defineBot } from '@haunt/bot';
import { crewBotOptions } from '../../../../packages/haunt/src/campaign/crew';

export default defineBot(crewBotOptions());
