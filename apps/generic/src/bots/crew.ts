// Generic app campaign Crew: the parts come from HAUNT_PARTS, as for the orders Crew.
import { crewBotOptions } from '../../../../packages/haunt/src/campaign/crew';
import { defineGenericBot } from '../../../../packages/haunt/src/bot/generic';

export default defineGenericBot(crewBotOptions());
