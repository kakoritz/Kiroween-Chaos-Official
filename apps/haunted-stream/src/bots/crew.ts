// Stream campaign Crew: the parts come from HAUNT_PARTS, as for the orders Crew.
import { crewBotOptions } from '../../../../packages/haunt/src/campaign/crew';
import { defineStreamBot } from '../define';

export default defineStreamBot(crewBotOptions());
