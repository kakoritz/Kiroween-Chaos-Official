// `npm run chain:grade` (the GitHub Action runs it). Spec: .kiro/specs/chain-wizard-v2 (second build list, item 7).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const grade = (...a: string[]) => spawnSync(process.execPath, [join(root, 'tools/run-ts.mjs'), join(root, 'packages/core/src/bin/chain-grade.ts'), ...a], { cwd: root, encoding: 'utf8' });
const pizza = join(root, 'examples/pizza-shop/haunt.yaml');

describe('chain:grade', () => {
  it('fails below the minimum grade and passes at or above it', () => {
    const bad = grade(pizza, '--min', 'B');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('grade F with rookie');
    const good = grade(pizza, '--tier', 'phoenix', '--min', 'A');
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('grade A with phoenix');
  }, 60_000);
  it('writes the report page and the badge', () => {
    const out = mkdtempSync(join(tmpdir(), 'cg-'));
    expect(grade(pizza, '--out', out).status).toBe(0);
    expect(readFileSync(join(out, 'chaos-report.html'), 'utf8')).toContain('Chaos report');
    expect(existsSync(join(out, 'chaos-badge.svg'))).toBe(true);
  }, 60_000);
  it('a bad file or flag exits 2', () => {
    expect(grade('nope.yaml').status).toBe(2);
    expect(grade(pizza, '--min', 'Z').status).toBe(2);
  }, 60_000);
});
