// Chain wizard v2 R7: every block has a hint line, shown in the wizard and in docs/BLOCKS.md. Spec: .kiro/specs/chain-wizard-v2.
import { describe, expect, it } from 'vitest';
import { BLOCKS, hintOf } from '../src/blocks/library';
import { blocksMarkdown } from '../src/blocks/doc';

describe('block hints', () => {
  // covers: chain-wizard-v2/R7.1
  it('every built-in block has its own hint, and a custom block falls back to its role line', () => {
    for (const b of BLOCKS) expect(hintOf(b).length, b.id).toBeGreaterThan(20);
    expect(hintOf({ id: 'mine', role: 'effect' })).toMatch(/idempotency/i);
    expect(hintOf({ id: 'mine', role: 'work', hint: 'Mine.' })).toBe('Mine.');
  });
  it('the generated doc shows each hint', () => {
    const md = blocksMarkdown();
    for (const b of BLOCKS) expect(md).toContain(hintOf(b));
  });
});
