// Chain wizard model. Spec: .kiro/specs/modular-engine (M5b, R12.3, R12.6).
import { describe, expect, it } from 'vitest';
import { addBlock, addCustom, chainProblems, emptyChain, fromConfig, move, removeAt, rename, toConfig, toYaml } from '../src/chain/model';
import { chainChecks, chainReport } from '../../haunt/src/blocks/cards';

const build = () => ['read_request', 'charge', 'notify'].reduce(addBlock, emptyChain('shop'));

describe('chain wizard model', () => {
  // covers: modular-engine/R12.3
  it('builds an ordered chain from blocks and gives each use its own id', () => {
    let m = build();
    m = addBlock(m, 'charge');
    expect(m.stages.map((s) => s.id)).toEqual(['read_request', 'charge', 'notify', 'charge_2']);
    expect(addBlock(m, 'teleport')).toBe(m);
  });

  it('moves, removes and renames, refusing a bad or taken id', () => {
    let m = build();
    m = move(m, 2, 0);
    expect(m.stages.map((s) => s.id)).toEqual(['notify', 'read_request', 'charge']);
    expect(move(m, 0, 9)).toBe(m);
    expect(rename(m, 0, 'Bad Id')).toBe(m);
    expect(rename(m, 0, 'charge')).toBe(m);
    expect(rename(m, 0, 'tell_user').stages[0]!.id).toBe('tell_user');
    expect(removeAt(m, 1).stages.map((s) => s.id)).toEqual(['notify', 'charge']);
  });

  it('adds a custom block with a clean id', () => {
    const m = addCustom(build(), 'Pay In Crypto!', 'effect', 'charge');
    expect(m.stages.at(-1)).toMatchObject({ id: 'pay_in_crypto', role: 'effect', effectKind: 'charge' });
    expect(addCustom(m, '1', 'work')).toBe(m);
  });

  it('says what stops a chain from running', () => {
    expect(chainProblems(emptyChain())).toEqual(['Add at least one block.']);
    expect(chainProblems(['validate', 'transform'].reduce(addBlock, emptyChain())).join()).toMatch(/input or an effect/);
    expect(chainProblems(build())).toEqual([]);
  });

  // covers: modular-engine/R12.6
  it('the chain and its haunt.yaml are two views of one flow', () => {
    const m = addCustom(build(), 'pay_coin', 'effect', 'charge');
    const text = toYaml(m);
    expect(text).toContain('use: charge');
    expect(text).toContain('id: pay_coin');
    const cfg = toConfig(m);
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;
    expect(cfg.config.stages.map((s) => s.id)).toEqual(['read_request', 'charge', 'notify', 'pay_coin']);
    const back = fromConfig(cfg.config);
    expect(back.stages.map((s) => [s.use, s.id, s.role])).toEqual(m.stages.map((s) => [s.use, s.id, s.role]));
    expect(toYaml(back)).toBe(text);
  });

  // covers: modular-engine/R12.3
  it('Test chain: the chain from the wizard runs as the Lab model and names the block that broke it', async () => {
    const cfg = toConfig(build());
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;
    const r = await chainReport(cfg.config, 'rookie');
    expect(r.blame.map((b) => b.block)).toEqual(['read_request', 'charge', 'notify']);
    expect(r.failed).toBeGreaterThan(0);
    expect(chainChecks(cfg.config).map((w) => w.id)).toContain('loose_effect');
  });
});
