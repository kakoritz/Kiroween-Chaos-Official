// CP-C2: the Python Crew stub (bot/crew.py) reads HAUNT_PARTS like the TypeScript Crew bot.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pyTest } from '../../../packages/core/test/python-skip';

const root = resolve(__dirname, '../../..');
const crew = join(root, 'apps/haunted-inbox/bot/crew.py');

function findPython(): string | null {
  for (const c of ['python', 'python3', 'py']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (/Python 3\.(1[1-9]|[2-9]\d)/.test(v)) return c;
    } catch { /* try the next one */ }
  }
  return null;
}
const py = findPython();
const pyIt = pyTest(py);

const parts = (env: string | undefined): string[] => JSON.parse(execFileSync(py!, [crew, '--parts'], {
  encoding: 'utf8', env: { ...process.env, HAUNT_TIER: undefined, HAUNT_PARTS: env },
})).parts;

describe('bot/crew.py', () => {
  pyIt('reports the parts of HAUNT_PARTS in the canonical order', () => {
    expect(parts('journal,idempotency')).toEqual(['journal', 'idempotency']);
    expect(parts('Q B')).toEqual(['breaker', 'offline_queue']);
    expect(parts('R J I B Q')).toEqual(['retry', 'journal', 'idempotency', 'breaker', 'offline_queue']);
    expect(parts('')).toEqual([]);
    expect(parts(undefined)).toEqual([]);
  });

  pyIt('rejects an unknown part', () => {
    expect(() => parts('sword')).toThrow();
  });
});
