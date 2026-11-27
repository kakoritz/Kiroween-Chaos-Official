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

  it('github actions: jobs in needs order, setup and install steps left out, and the note says so', () => {
    const r = importFlow(read('github-actions-deploy.yml'));
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe('github-actions');
    expect(importedBlocks(r)).toEqual(['read_request', 'transform', 'dispatch_job', 'notify']);
    expect(r.notes.join(' ')).toMatch(/1 setup, cache or install step/);
  });
  it('github actions: a job that needs another comes after it, whatever the file order', () => {
    const r = importFlow('jobs:\n  ship:\n    needs: build\n    steps:\n      - name: Deploy it\n        run: ./go.sh\n  build:\n    steps:\n      - name: Run the tests\n        run: |\n          make test\n');
    if (!r.ok) throw new Error(r.error);
    expect(importedBlocks(r)).toEqual(['transform', 'dispatch_job']);
  });
  it('a node and edge graph (LangGraph, React Flow): from the start node along the edges', () => {
    const r = importFlow(read('langgraph-support-agent.json'));
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe('langgraph');
    expect(importedBlocks(r)).toEqual(['read_request', 'transform', 'refund', 'send_email', 'file_ticket']);
    expect(r.notes.join(' ')).toMatch(/branches/);
  });
  it('edges as pairs work too, and every format makes a chain that grades', async () => {
    const pairs = importFlow(JSON.stringify({ nodes: [{ id: 'a', name: 'Webhook' }, { id: 'b', name: 'Stripe charge' }], edges: [['a', 'b']] }));
    if (!pairs.ok) throw new Error(pairs.error);
    expect(importedBlocks(pairs)).toEqual(['read_request', 'charge']);
    for (const f of ['github-actions-deploy.yml', 'langgraph-support-agent.json']) {
      const r = importFlow(read(f));
      if (!r.ok) throw new Error(r.error);
      const c = toConfig(importedBlocks(r).reduce(addBlock, emptyChain('x')));
      expect(c.ok, f).toBe(true);
      if (c.ok) expect((await chainReport(c.config, 'rookie')).tried).toBeGreaterThan(0);
    }
  });
  it('text that is neither says what it expected', () => {
    const r = importFlow('just: [words');
    expect(r.ok).toBe(false);
    const r2 = importFlow('{"hello": 1}');
    expect(!r2.ok && r2.error).toMatch(/GitHub Actions workflow/);
  });
});
