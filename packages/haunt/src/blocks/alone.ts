// Block-alone mode (modular-engine R4.6): one library block as a one-stage app, so it can be attacked before it is chained.
import type { HauntConfig } from '../config/haunt-config';
import { blockById } from './library';
import { appFromConfig } from '../shared/registry';
import type { AppDef } from '../shared/catalog';

export const aloneId = (blockId: string): string => `block-${blockId.replace(/_/g, '-')}`;

/** The haunt config of `blockId` run alone, or null for an unknown block. */
export function blockAsConfig(blockId: string): HauntConfig | null {
  const b = blockById(blockId);
  if (!b) return null;
  return {
    name: aloneId(b.id), label: `Block: ${b.label}`, idPrefix: 'blk', start: 'node dist/bot.js', adapter: ['sdk'],
    stages: [{ id: b.id, label: b.label, role: b.role, effects: b.effects.map((e) => ({ ...e })), duration: b.duration, block: b.id }],
    ...(b.effects.length ? { truth: 'http://127.0.0.1:7071' } : {}),
    targets: { recoverMs: 20000, repeats: 0, concurrency: 8 },
  };
}

export function blockAsApp(blockId: string): AppDef | null {
  const c = blockAsConfig(blockId);
  return c ? appFromConfig(c) : null;
}
