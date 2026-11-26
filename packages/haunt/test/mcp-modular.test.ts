// The MCP server's modular tools. Spec: .kiro/specs/modular-engine (R12) and the Crew app bonus (.kiro/specs/crew-app-bonus).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS, callTool, handle } from '../src/mcp/server';

const empty = mkdtempSync(join(tmpdir(), 'mcp-'));
const opts = { root: empty };
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await callTool(opts, name, args)) as { content: { text: string }[]; isError: boolean };
  return { error: r.isError, body: (() => { try { return JSON.parse(r.content[0]!.text); } catch { return r.content[0]!.text; } })() as any };
};

describe('modular MCP tools work with no repository checkout', () => {
  it('lists haunt_blocks, haunt_chain and haunt_lab', async () => {
    const list = (await handle(opts, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['haunt_blocks', 'haunt_chain', 'haunt_lab', 'haunt_define']));
    expect(TOOLS.length).toBeGreaterThanOrEqual(9);
  });

  it('haunt_blocks lists the library and, with a tier, each block card', async () => {
    const plain = await call('haunt_blocks', {});
    expect(plain.body.blocks.length).toBeGreaterThanOrEqual(22);
    const carded = await call('haunt_blocks', { tier: 'rookie', block: 'charge' });
    expect(carded.body.cards[0]).toMatchObject({ blockId: 'charge', tier: 'rookie', modelBased: true });
    expect(carded.body.cards[0].failedFaults.length).toBeGreaterThan(0);
    expect((await call('haunt_blocks', { block: 'teleport' })).error).toBe(true);
  });

  it('haunt_chain names the block that broke the chain and warns', async () => {
    const r = await call('haunt_chain', { blocks: ['read_request', 'charge', 'wait_for_callback', 'notify'], tier: 'rookie' });
    expect(r.error).toBe(false);
    expect(r.body.blame.map((b: { block: string }) => b.block)).toEqual(['read_request', 'charge', 'wait_for_callback', 'notify']);
    expect(r.body.failed).toBeGreaterThan(0);
    expect(r.body.warnings.map((w: { id: string }) => w.id)).toContain('poll_after_effect');
    const better = await call('haunt_chain', { blocks: ['read_request', 'charge', 'notify'], tier: 'phoenix' });
    const worse = await call('haunt_chain', { blocks: ['read_request', 'charge', 'notify'], tier: 'rookie' });
    expect(better.body.failed).toBeLessThan(worse.body.failed);
  });

  it('haunt_chain and haunt_lab read a haunt.yaml; errors say what to give', async () => {
    const f = join(empty, 'haunt.yaml');
    writeFileSync(f, 'name: shop\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n  - { use: read_request }\n  - { use: charge }\n  - { use: confirm }\n');
    expect((await call('haunt_chain', { config: f })).body.blame.length).toBe(3);
    const lab = await call('haunt_lab', { config: f, tier: 'rookie' });
    expect(lab.body).toMatchObject({ modelBased: true, name: 'shop', tier: 'rookie' });
    expect(lab.body.failingCells.length).toBeGreaterThan(0);
    expect((await call('haunt_chain', {})).body).toMatch(/give blocks/);
    expect((await call('haunt_chain', { blocks: ['nope'] })).body).toMatch(/unknown block\(s\): nope/);
    expect((await call('haunt_lab', { config: join(empty, 'missing.yaml') })).body).toMatch(/config not found/);
  });

  it('haunt_sweep without a checkout says how to get one instead of crashing', async () => {
    const r = await call('haunt_sweep', {});
    expect(r.error).toBe(true);
    expect(r.body).toMatch(/needs a Kiroween Chaos checkout: set HAUNT_ROOT/);
  });
});
