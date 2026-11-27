// Own attacks in the Chain Wizard (fourth build list item 2): the model, the haunt.yaml, the share link.
import { describe, expect, it } from 'vitest';
import { addAttack, addBlock, emptyChain, fromConfig, removeAt, removeAttack, rename, toConfig, toYaml } from '../src/chain/model';
import { decodeChain, encodeChain } from '../src/chain/save';

const chain = () => ['read_request', 'charge', 'send_email'].reduce(addBlock, emptyChain('shop'));

describe('own attacks in the wizard', () => {
  it('adds one, writes it into haunt.yaml, and the manifest parses it back', () => {
    const r = addAttack(chain(), { label: 'Card Decliner', base: 'http_500', stages: ['charge'], count: 4 });
    expect(r.error).toBeUndefined();
    const y = toYaml(r.model);
    expect(y).toContain('attacks:');
    expect(y).toContain('id: card_decliner, label: "Card Decliner", base: http_500, stages: [charge], count: 4');
    const c = toConfig(r.model);
    expect(c.ok && c.config.attacks).toEqual([{ id: 'card_decliner', label: 'Card Decliner', base: 'http_500', stages: ['charge'], count: 4 }]);
    expect(c.ok && fromConfig(c.config).attacks).toEqual(c.ok ? c.config.attacks : []);
  });
  it('a clash in the name gets a number; a bad one says why', () => {
    let m = addAttack(chain(), { label: 'Rush', base: 'slow_link', stages: ['charge'], forMs: 4000 }).model;
    m = addAttack(m, { label: 'Rush', base: 'slow_link', stages: ['send_email'] }).model;
    expect(m.attacks!.map((a) => a.id)).toEqual(['rush', 'rush_2']);
    expect(addAttack(chain(), { label: '!', base: 'http_500', stages: ['charge'] }).error).toMatch(/two letters/);
    expect(addAttack(chain(), { label: 'Boom', base: 'http_500', stages: [] }).error).toMatch(/at least one stage/);
    expect(addAttack(chain(), { label: 'Boom', base: 'http_500', stages: ['charge'], count: 99 }).error).toMatch(/count/);
    expect(addAttack(chain(), { label: 'Boom', base: 'nope', stages: ['charge'] }).error).toMatch(/base/);
  });
  it('removing or renaming a stage keeps the attacks right', () => {
    const m = addAttack(chain(), { label: 'Card Decliner', base: 'http_500', stages: ['charge'], count: 2 }).model;
    expect(rename(m, 1, 'pay').attacks![0]!.stages).toEqual(['pay']);
    expect(removeAt(m, 1).attacks).toBeUndefined();
    expect(removeAttack(m, 'card_decliner').attacks).toBeUndefined();
  });
  it('survives the share link, and a link naming a missing stage is refused', () => {
    const m = addAttack(chain(), { label: 'Card Decliner', base: 'http_500', stages: ['charge'], count: 2 }).model;
    expect(decodeChain(encodeChain(m))?.attacks).toEqual(m.attacks);
    expect(decodeChain(encodeChain({ ...m, attacks: [{ ...m.attacks![0]!, stages: ['ghost'] }] }))).toBeUndefined();
  });
});
