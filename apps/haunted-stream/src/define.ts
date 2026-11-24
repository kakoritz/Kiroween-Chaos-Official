import { defineBot, type BotDef } from '../../../packages/haunt/src/bot';
import { STREAM_WORK, StreamPipeline } from './pipeline';

/** A Stream bot: the orders `defineBot` with the Stream pipeline and stage table. */
export const defineStreamBot = (def: BotDef): BotDef => defineBot({ ...def, pipeline: (d) => new StreamPipeline(d), stages: STREAM_WORK });
