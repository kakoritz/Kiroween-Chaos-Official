// Block score cards, chain blame and chain checks, custom blocks. Spec: .kiro/specs/modular-engine (M5b, R12, R13).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allBlockCards, chainChecks, chainReport, runBlock, CARD_TIERS } from '../src/blocks/cards';
import { BLOCKS, blockById, registerBlock, validateBlock } from '../src/blocks/library';
import { loadUserBlocks, promoteStageToBlock } from '../src/blocks/user-blocks';
import { parseHauntConfig } from '../src/config/haunt-config';

const cfg = (stages: string) => { const r = parseHauntConfig(`name: shop\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n${stages}`); if (!r.ok) throw new Error(r.errors.join()); return r.config; };

describe('block score cards', () => {
  // covers: modular-engine/R12.1
  it('a Rookie charge block repeats and fails attacks that a Phoenix survives', async () => {
    const rookie = (await runBlock('charge', 'rookie'))!;
    const phoenix = (await runBlock('charge', 'phoenix'))!;
    expect(rookie.tried).toBeGreaterThan(5);
    expect(rookie.survived).toBeLessThan(rookie.tried);
    expect(rookie.failedFaults.length).toBeGreaterThan(0);
    expect(phoenix.survived).toBeGreaterThan(rookie.survived);
    expect(phoenix.failedFaults.length).toBeLessThan(rookie.failedFaults.length);
    expect(phoenix.modelBased).toBe(true);
  });

  it('is seeded and refuses an unknown block', async () => {
    expect(await runBlock('charge', 'journaler', 3)).toEqual(await runBlock('charge', 'journaler', 3));
    expect(await runBlock('teleport', 'rookie')).toBeNull();
  });

  // covers: modular-engine/R12.2
  it('every block has a card at every tier', async () => {
    const cards = await allBlockCards();
    expect(cards.length).toBe(BLOCKS.length * CARD_TIERS.length);
    expect(cards.every((c) => c.tried > 0)).toBe(true);
  });
});

describe('chain report and checks', () => {
  const chain = cfg('  - { use: read_request }\n  - { use: charge }\n  - { use: wait_for_callback }\n  - { use: notify }\n  - { id: brew, label: Brew, role: work }\n');

  // covers: modular-engine/R12.4
  it('blames failures on the stage and block that produced them, shares add to one', async () => {
    const r = await chainReport(chain, 'rookie');
    expect(r.blame.map((b) => b.stage)).toEqual(['read_request', 'charge', 'wait_for_callback', 'notify', 'brew']);
    expect(r.blame.find((b) => b.stage === 'charge')).toMatchObject({ block: 'charge' });
    expect(r.blame.find((b) => b.stage === 'brew')!.block).toBeUndefined();
    expect(r.failed).toBeGreaterThan(0);
    expect(r.blame.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 5);
    const top = [...r.blame].sort((a, b) => b.failed - a.failed)[0]!;
    expect(top.failed).toBeGreaterThan(0);
    expect((await chainReport(chain, 'phoenix')).failed).toBeLessThan(r.failed);
  });

  // covers: modular-engine/R12.5
  it('warns about a chain even when each block passed alone', async () => {
    const cards = await Promise.all(['charge', 'wait_for_callback'].map((b) => runBlock(b, 'phoenix')));
    const w = chainChecks(chain, cards.filter((c) => c !== null));
    expect(w.map((x) => x.id)).toEqual(expect.arrayContaining(['poll_after_effect', 'loose_effect']));
    expect(w.find((x) => x.id === 'poll_after_effect')!.stage).toBe('wait_for_callback');
  });

  it('warns about a chain with no input and about a shared key; a clean chain is quiet', () => {
    const noIn = cfg('  - { use: charge }\n  - { use: notify }\n');
    expect(chainChecks(noIn).map((w) => w.id)).toContain('no_input');
    const shared = cfg('  - { use: read_request }\n  - { id: a, label: A, role: effect, effects: [{ kind: charge, key: "k", idempotent: required }] }\n  - { id: b, label: B, role: effect, effects: [{ kind: charge, key: "k", idempotent: required }] }\n');
    expect(chainChecks(shared).map((w) => w.id)).toContain('shared_key');
    const clean = cfg('  - { use: read_request }\n  - { use: charge }\n  - { use: confirm }\n');
    expect(chainChecks(clean)).toEqual([]);
  });

  // covers: modular-engine/R12.5
  it('a weak block alone shows up as a warning on its stage', async () => {
    const card = (await runBlock('charge', 'rookie'))!;
    expect(chainChecks(chain, [card]).some((w) => w.id === 'weak_block' && w.stage === 'charge')).toBe(true);
  });
});

describe('custom blocks', () => {
  // covers: modular-engine/R13.1
  it('an inline stage with no library block is tested alone and in a chain like any other', async () => {
    const c = cfg('  - { use: read_request }\n  - id: pay_crypto\n    label: Pay in crypto\n    role: effect\n    effects:\n      - { kind: charge, key: "crypto:1", idempotent: required }\n');
    const r = await chainReport(c, 'rookie');
    expect(r.blame.find((b) => b.stage === 'pay_crypto')!.tried).toBeGreaterThan(0);
    expect(r.blame.find((b) => b.stage === 'pay_crypto')!.block).toBeUndefined();
  });

  // covers: modular-engine/R13.3
  it('promotes an inline stage to the library and reads it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blk-'));
    const manifest = join(dir, 'haunt.yaml');
    writeFileSync(manifest, 'name: crypto\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n  - { id: read_in, label: Read, role: input }\n  - id: pay_coin\n    label: Pay in coin\n    role: effect\n    effects:\n      - { kind: charge, key: "coin:1", idempotent: required }\n');
    const file = join(dir, 'user.yaml');
    const bad = promoteStageToBlock(manifest, 'nope', file);
    expect(!bad.ok && bad.errors[0]).toMatch(/no stage "nope"/);
    const dupe = promoteStageToBlock(manifest, 'read_in', file);
    expect(dupe.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('id: read_in');
    const before = BLOCKS.length;
    expect(loadUserBlocks(file)).toEqual([]);
    expect(blockById('read_in')?.role).toBe('input');
    expect(BLOCKS.length).toBe(before + 1);
    expect(loadUserBlocks(file)).toEqual([]);
    expect(BLOCKS.length).toBe(before + 1);
    expect((await runBlock('read_in', 'rookie'))!.tried).toBeGreaterThan(0);
    const again = promoteStageToBlock(manifest, 'read_in', file);
    expect(!again.ok && again.errors.join()).toMatch(/already a block/);
    BLOCKS.splice(before, 1);
  });

  it('rejects a malformed block', () => {
    expect(validateBlock({ id: 'Bad', label: '', role: 'effect', effects: [], duration: [5, 1] }).length).toBeGreaterThanOrEqual(4);
    expect(() => registerBlock({ id: 'charge', label: 'x', role: 'work', about: '', effects: [], duration: [1, 2] })).toThrow(/already a block/);
  });
});
