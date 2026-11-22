// Wave-end hook: when a stream carries a `wave_end` event, run the reviewer (LLM when asked, rules otherwise) and write the review files.
import type { HauntEvent } from '../score/score';
import { writeReview, type WrittenReview } from './index';
import { runReviewerLlm, type LlmReviewOptions, type LlmReviewResult } from './llm';

export const hasWaveEnd = (events: HauntEvent[]): boolean => events.some((e) => e.type === 'wave_end');

export interface WaveEndOptions extends LlmReviewOptions { llm?: boolean; specsDir?: string; /** Write the serious spec (pattern miner, TV3-C12) instead of the rule-based text. */ fixSpec?: boolean }
export interface WaveEndReview { result: LlmReviewResult; written: WrittenReview }

/** Returns undefined when the wave has not ended. Without `llm` the provider is ignored and the rule reviewer runs. */
export async function onWaveEnd(root: string, run: string, events: HauntEvent[], opts: WaveEndOptions = {}): Promise<WaveEndReview | undefined> {
  if (!hasWaveEnd(events)) return undefined;
  const o: LlmReviewOptions = opts.llm ? opts : { ...opts, provider: undefined, env: {} };
  const result = await runReviewerLlm(run, events, o);
  const written = writeReview(root, opts.specsDir ?? `${root}/.kiro/specs`, run, result);
  return { result, written };
}
