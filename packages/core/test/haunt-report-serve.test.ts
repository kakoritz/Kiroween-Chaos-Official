// H7: `haunt report <run>` and `haunt serve`.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findAnyRun, reportCommand } from '../../haunt/src/report/cli';
import { planServe } from '../src/bin/serve';

const root = resolve(__dirname, '../../..');
const sweep = { app: 'haunted-orders', grade: 'B', reliability: 0.8, cells: [{ stage: 'payment', creature: 'reaper', fault: 'crash', outcome: 'repeat', repeatedKinds: ['charge'] }], findings: [] };

describe('haunt report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haunt-report-'));
  mkdirSync(join(dir, '.haunt', 'sweeps'), { recursive: true });
  writeFileSync(join(dir, '.haunt', 'sweeps', 'sweep-phoenix-seed1.json'), JSON.stringify(sweep));

  it('finds a run by name, with or without .json, and by path', () => {
    expect(findAnyRun(dir, 'sweep-phoenix-seed1')).toBe(join(dir, '.haunt', 'sweeps', 'sweep-phoenix-seed1.json'));
    expect(findAnyRun(dir, 'sweep-phoenix-seed1.json')).not.toBeNull();
    expect(findAnyRun(dir, '.haunt/sweeps/sweep-phoenix-seed1.json')).not.toBeNull();
    expect(findAnyRun(dir, 'nope')).toBeNull();
    expect(findAnyRun(dir, '../etc/passwd')).toBeNull();
  });

  it('prints md, html and json', () => {
    const md = reportCommand(dir, 'sweep-phoenix-seed1', 'md');
    expect('text' in md && md.text).toContain('grade B');
    const html = reportCommand(dir, 'sweep-phoenix-seed1', 'html');
    expect('text' in html && html.text).toMatch(/<html/i);
    const json = reportCommand(dir, 'sweep-phoenix-seed1', 'json');
    expect('text' in json && JSON.parse(json.text).grade).toBe('B');
  });

  it('reports a missing run or a bad format as an error', () => {
    expect(reportCommand(dir, 'nope', 'md')).toEqual({ error: 'run not found: nope' });
    expect(reportCommand(dir, 'sweep-phoenix-seed1', 'pdf')).toMatchObject({ error: expect.stringContaining('--format') });
  });

  it('is wired into the CLI (exit 2 on usage errors)', () => {
    const run = (...a: string[]) => { try { execFileSync(process.execPath, [join(root, 'tools/run-ts.mjs'), join(root, 'packages/core/src/bin/haunt.ts'), ...a], { cwd: dir, stdio: 'pipe' }); return 0; } catch (e: any) { return e.status as number; } };
    expect(run('report')).toBe(2);
    expect(run('report', 'nope')).toBe(2);
    expect(run('report', 'sweep-phoenix-seed1', '--format', 'json')).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe('haunt serve', () => {
  it('plans live by default and mock on request, with the port in the right variable', () => {
    expect(planServe([], root)).toMatchObject({ script: join(root, 'packages/core/src/bin/live.ts'), env: {} });
    expect(planServe(['--port', '7099'], root)).toMatchObject({ env: { HAUNT_PORT: '7099' } });
    expect(planServe(['--mode', 'mock', '--port', '7098'], root)).toMatchObject({ script: join(root, 'packages/core/src/bin/mock.ts'), env: { PORT: '7098' } });
  });
  it('rejects a bad mode or port', () => {
    expect(planServe(['--mode', 'prod'], root)).toHaveProperty('error');
    expect(planServe(['--port', 'x'], root)).toHaveProperty('error');
    expect(planServe(['--port', '70000'], root)).toHaveProperty('error');
  });
});
