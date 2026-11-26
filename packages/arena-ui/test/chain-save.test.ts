// Chain wizard v2 R4 (examples) and R5 (save and share). Spec: .kiro/specs/chain-wizard-v2.
import { describe, expect, it } from 'vitest';
import { CHAIN_EXAMPLES, exampleChain } from '../src/chain/examples';
import { addCustom, chainProblems, emptyChain, toConfig, toYaml } from '../src/chain/model';
import { decodeChain, encodeChain, shareUrl, yamlFileName } from '../src/chain/save';

describe('example chains', () => {
  // covers: chain-wizard-v2/R4.1
  it('offers at least four examples and each one is a runnable chain', () => {
    expect(CHAIN_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const e of CHAIN_EXAMPLES) {
      const m = exampleChain(e.id)!;
      expect(m.stages.length, e.id).toBe(e.blocks.length);
      expect(chainProblems(m), e.id).toEqual([]);
      expect(toConfig(m).ok, e.id).toBe(true);
    }
    expect(exampleChain('nope')).toBeUndefined();
  });
});

describe('save and share', () => {
  // covers: chain-wizard-v2/R5.1
  it('a link restores the same chain, custom stages included', () => {
    const m = addCustom(exampleChain('checkout')!, 'Pay In Crypto', 'effect', 'charge');
    const back = decodeChain(`#c=${encodeChain(m)}`)!;
    expect(back).toEqual(m);
    expect(toYaml(back)).toBe(toYaml(m));
    expect(decodeChain(shareUrl('http://x/chain.html?a=1#old', m).split('#')[1]!)).toEqual(m);
  });
  it('keeps non-ascii names', () => {
    const m = { ...emptyChain('café ☕'), stages: exampleChain('signup')!.stages };
    expect(decodeChain(encodeChain(m))!.name).toBe('café ☕');
  });
  it('refuses damaged links and unknown blocks without throwing', () => {
    expect(decodeChain('#c=%%%')).toBeUndefined();
    expect(decodeChain('#c=' + btoa('{"n":1}'))).toBeUndefined();
    const bad = btoa(JSON.stringify({ n: 'x', s: [['teleport', 'tele', 'T', 'effect', '']] }));
    expect(decodeChain(bad)).toBeUndefined();
  });
  it('names the download after the chain', () => {
    expect(yamlFileName({ name: 'My Shop!', stages: [] })).toBe('my-shop.haunt.yaml');
    expect(yamlFileName({ name: '!!!', stages: [] })).toBe('my-chain.haunt.yaml');
  });
});
