// "Save as block" in the Chain Wizard. Spec: .kiro/specs/chain-wizard-v2 (second build list, item 2).
import { afterEach, describe, expect, it } from 'vitest';
import { BLOCKS, blockById } from '../../haunt/src/blocks/library';
import { forgetMyBlocks, isMine, loadMyBlocks, saveMyBlock, MY_BLOCKS_KEY, blockFromStage, type MyStore } from '../src/chain/my-blocks';
import { addCustom, emptyChain, toConfig } from '../src/chain/model';
import { chainReport, runBlock } from '../../haunt/src/blocks/cards';

afterEach(() => { forgetMyBlocks(); });
const mem = (): MyStore & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }; };
const custom = (id = 'pay_coin') => addCustom(emptyChain(), id, 'effect', 'charge').stages[0]!;

describe('my blocks', () => {
  it('a custom effect stage becomes a block with an effect, a label and a duration', () => {
    const b = blockFromStage(custom());
    expect(b).toMatchObject({ id: 'pay_coin', role: 'effect', effects: [{ kind: 'charge', key: 'pay_coin:1', idempotent: 'required' }] });
    expect(b.duration[0]).toBeLessThanOrEqual(b.duration[1]);
  });

  it('saving puts it in the library and in storage; it can be tested alone and chained', async () => {
    const store = mem();
    const before = BLOCKS.length;
    expect(saveMyBlock(custom(), store).ok).toBe(true);
    expect(BLOCKS.length).toBe(before + 1);
    expect(isMine('pay_coin')).toBe(true);
    expect(JSON.parse(store.data.get(MY_BLOCKS_KEY)!).map((b: { id: string }) => b.id)).toEqual(['pay_coin']);
    expect((await runBlock('pay_coin', 'rookie'))!.tried).toBeGreaterThan(0);
    const chain = toConfig({ name: 'c', stages: [{ use: 'read_request', id: 'read_request', label: 'Read request', role: 'input' }, { use: 'pay_coin', id: 'pay_coin', label: 'pay coin', role: 'effect' }] });
    expect(chain.ok).toBe(true);
    if (chain.ok) expect((await chainReport(chain.config, 'rookie')).blame.find((b) => b.stage === 'pay_coin')!.block).toBe('pay_coin');
  });

  it('refuses a stage that already has a block, a clashing id, and a bad id, with the reason', () => {
    const store = mem();
    expect(saveMyBlock({ use: 'charge', id: 'charge', label: 'Charge', role: 'effect' }, store)).toMatchObject({ ok: false });
    const clash = saveMyBlock({ id: 'charge', label: 'x', role: 'effect', effectKind: 'charge' }, store);
    expect(!clash.ok && clash.errors.join()).toMatch(/already a block/);
    expect(saveMyBlock({ id: 'Bad Id', label: 'x', role: 'work' }, store).ok).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it('comes back on the next visit, once, and skips junk', () => {
    const store = mem();
    saveMyBlock(custom('brew_tea'), store);
    forgetMyBlocks();
    expect(blockById('brew_tea')).toBeUndefined();
    expect(loadMyBlocks(store)).toBe(1);
    expect(blockById('brew_tea')).toBeDefined();
    expect(loadMyBlocks(store)).toBe(0);
    forgetMyBlocks();
    store.setItem(MY_BLOCKS_KEY, '[{"id":"Bad Id"},{"id":"charge"},"x",null]');
    expect(loadMyBlocks(store)).toBe(0);
    store.setItem(MY_BLOCKS_KEY, 'not json');
    expect(loadMyBlocks(store)).toBe(0);
  });
});
