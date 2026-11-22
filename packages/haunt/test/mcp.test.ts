import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const repo = resolve(__dirname, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'haunt-mcp-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
mkdirSync(join(work, '.haunt', 'sweeps'), { recursive: true });
writeFileSync(join(work, '.haunt', 'sweeps', 'sweep-rookie-seed1.json'), JSON.stringify({ grade: 'F', reliability: 0.2 }));

describe('haunt-mcp over stdio', () => {
  it('speaks JSON-RPC: initialize, tools/list, define, report, errors', async () => {
    const child = spawn(process.execPath, [join(repo, 'tools', 'run-ts.mjs'), join(repo, 'packages', 'core', 'src', 'bin', 'haunt-mcp.ts')], { cwd: repo, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const call = async (msg: object): Promise<any> => {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
      const { value } = await lines.next();
      return JSON.parse(value as string);
    };
    try {
      const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(init.result.serverInfo.name).toBe('haunt-mcp');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['haunt_define', 'haunt_sweep', 'haunt_ramp', 'haunt_report', 'haunt_specs', 'haunt_badge']);
      const def = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'haunt_define', arguments: {} } });
      expect(def.result.isError).toBe(false);
      expect(JSON.parse(def.result.content[0].text).ok).toBe(true);
      const bad = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'haunt_define', arguments: { config: join(work, 'nope.yaml') } } });
      expect(bad.result.isError).toBe(true);
      const rep = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'haunt_report', arguments: { path: join(work, '.haunt', 'sweeps', 'sweep-rookie-seed1.json') } } });
      expect(JSON.parse(rep.result.content[0].text).grade).toBe('F');
      const unk = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
      expect(unk.error.code).toBe(-32602);
      const nm = await call({ jsonrpc: '2.0', id: 7, method: 'nope' });
      expect(nm.error.code).toBe(-32601);
    } finally {
      child.stdin.end();
      child.kill();
    }
  }, 60_000);
});
