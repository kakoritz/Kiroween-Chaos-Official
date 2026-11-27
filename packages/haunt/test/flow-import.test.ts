// covers: flow import (third build list item 2). Real exports in examples/flows, turned into chains that run and grade.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFlow, importedBlocks } from '../src/import/flow-import';
import { addBlock, emptyChain, toConfig } from '../../arena-ui/src/chain/model';
import { chainReport } from '../src/blocks/cards';

const root = resolve(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'examples/flows', f), 'utf8');

describe('flow import', () => {
  it('n8n: follows the connections, by node type first', () => {
    const r = importFlow(read('n8n-order-flow.json'));
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe('n8n');
    expect(importedBlocks(r)).toEqual(['read_request', 'transform', 'charge', 'store_record', 'send_email', 'confirm', 'notify']);
    expect(r.steps.every((s) => s.why.length > 0)).toBe(true);
    expect(r.notes.some((n) => /branches/.test(n))).toBe(true);
  });
  it('zapier: a step list becomes a chain', () => {
    const r = importFlow(read('zapier-signup.json'));
    if (!r.ok) throw new Error(r.error);
    expect(r.name).toBe('New signup');
    expect(importedBlocks(r)).toEqual(['read_request', 'create_account', 'send_email', 'notify']);
  });
  it('an imported chain runs and gets a grade', async () => {
    const r = importFlow(read('n8n-order-flow.json'));
    if (!r.ok) throw new Error(r.error);
    const c = toConfig(importedBlocks(r).reduce(addBlock, emptyChain('x')));
    expect(c.ok).toBe(true);
    if (c.ok) expect((await chainReport(c.config, 'rookie')).tried).toBeGreaterThan(0);
  });
  it('says plainly when it cannot read the file or match a step', () => {
    expect(importFlow('nope')).toMatchObject({ ok: false });
    expect(importFlow('{"hello":1}')).toMatchObject({ ok: false });
    expect(importFlow('{"steps":[{"app":"qqq zzz"}]}')).toMatchObject({ ok: false });
  });
  it('skips disabled nodes and says it left out unknown ones', () => {
    const r = importFlow(JSON.stringify({ nodes: [{ name: 'Start', type: 'n8n-nodes-base.webhook' }, { name: 'Mystery', type: 'x.qqq' }, { name: 'Off', type: 'n8n-nodes-base.stripe', disabled: true }], connections: {} }));
    if (!r.ok) throw new Error(r.error);
    expect(importedBlocks(r)).toEqual(['read_request']);
    expect(r.notes.join(' ')).toMatch(/Mystery.*left out/);
    expect(r.notes.join(' ')).toMatch(/Disabled/);
  });
});
