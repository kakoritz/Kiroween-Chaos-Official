// Chain wizard v2 R8: readable lane cards on a phone. Spec: .kiro/specs/chain-wizard-v2.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { laneCards } from '../src/arena/lane-cards';
import { newLane } from '../src/arena/model';

const stages = [{ id: 'read_request', label: 'Read request' }, { id: 'pay', label: 'Take payment' }];
const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('lane cards', () => {
  // covers: chain-wizard-v2/R8.1
  it('gives one card per lane with the app\'s own stage labels and a word for the state', () => {
    const a = newLane(1, stages.length, 0);
    const b = { ...newLane(2, stages.length, 0), order: 'ord-1', stageIndex: 1, mode: 'working' as const };
    const cards = laneCards({ lanes: [a, b], stages });
    expect(cards).toHaveLength(2);
    expect(cards[0]!.now).toBe('Waiting for work');
    expect(cards[1]!.now).toContain('Take payment');
    expect(cards[1]!.chips.map((c) => c.label)).toEqual(['Read request', 'Take payment']);
    expect(cards[1]!.state.label.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.percent >= 0 && c.percent <= 100)).toBe(true);
  });
  it('shows only in narrow mode, with a big tap target', () => {
    const css = read('../src/arena/lane-cards.css');
    expect(css).toMatch(/#lane-cards \{ display: none/);
    expect(css).toMatch(/body\.narrow #lane-cards \{ display: flex/);
    expect(css).toMatch(/min-height: 44px/);
  });
});
