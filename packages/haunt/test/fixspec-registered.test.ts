// Chain wizard v2 R6: a registered app's hardening spec uses its own stage names and its own bot file. Spec: .kiro/specs/chain-wizard-v2.
import { describe, expect, it } from 'vitest';
import { patchFor, renderFixSpec, type Pattern } from '../src/miner';

const pat = (o: Partial<Pattern>): Pattern => ({
  id: 'p-000000aa', signature: 'pay + timeout + duplicate_effect', stage: 'pay', fault: 'timeout', consequence: 'duplicate_effect', shapes: ['case'], count: 5, lanes: [1],
  downtimeMsTotal: 3000, lostOrders: 0, repeats: 5, points: 0, firstSeen: { run: 'run-a', round: 1, order: 'ord-0001', lane: 1 }, lastSeen: { run: 'run-a', round: 2, lane: 1 }, status: 'new', runs: ['run-a#r1'],
  evidence: [{ run: 'run-a', round: 1, seq: [3], journal: [], report: '/api/waves/1/report' }], solvedBy: [], ...o,
});
const ctx = { stageLabels: { pay: 'Take payment' }, botFile: 'your bot (the `start` file in haunt.yaml)' };

describe('hardening spec for a registered app', () => {
  // covers: chain-wizard-v2/R6.1
  it('names the stage by its label and points at the app bot, not the Orders bot', () => {
    const own = patchFor(pat({}), ctx)!;
    expect(own.summary).toContain('Take payment (`pay`)');
    expect(own.ears).toContain('Take payment (`pay`)');
    expect(own.files.join(' ')).not.toMatch(/haunted-orders|packages\/haunt/);
    expect(own.files).toContain(ctx.botFile);
    expect(own.test.file).toBe('tests/hardening-p-000000aa.test.ts');
  });
  it('leaves a built-in app unchanged when no context is given', () => {
    const plain = patchFor(pat({}))!;
    expect(plain.files.join(' ')).toContain('apps/haunted-orders/src/bots/rookie.ts');
    expect(plain.summary).not.toContain('Take payment');
  });
  it('the whole spec carries the label and no Orders paths', () => {
    const s = renderFixSpec({ runId: 'r1', patterns: [pat({})], context: ctx });
    expect(s.design).toContain('Take payment');
    expect(s.design + s.tasks).not.toMatch(/haunted-orders/);
  });
});
