// The Kiro Power lists every tool the server has and ships the skills it names. Spec: .kiro/specs/chain-wizard-v2 (item 1 of the second build list).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/mcp/server';

const dir = join(__dirname, '..', '..', '..', 'kiro-power');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

describe('kiro-power', () => {
  it('auto-approves only read-only tools that exist, never the ones that start servers', () => {
    const m = JSON.parse(read('mcp.json')).mcpServers.haunt;
    const names = TOOLS.map((t) => t.name);
    for (const a of m.autoApprove) expect(names, a).toContain(a);
    expect(m.autoApprove).toEqual(expect.arrayContaining(['haunt_blocks', 'haunt_chain', 'haunt_lab']));
    for (const t of ['haunt_sweep', 'haunt_ramp', 'haunt_specs', 'haunt_badge']) expect(m.autoApprove).not.toContain(t);
  });
  it('the README names every tool and the skills exist', () => {
    const readme = read('README.md');
    for (const t of TOOLS) expect(readme, t.name).toContain(t.name);
    for (const s of ['stress-test-my-workflow', 'build-and-test-a-chain']) {
      expect(existsSync(join(dir, 'skills', s, 'SKILL.md')), s).toBe(true);
      expect(readme).toContain(s);
    }
  });
  it('points at the real repository', () => {
    expect(JSON.parse(read('plugin.json')).repository).toBe('https://github.com/kakoritz/Kiroween-Chaos-Official');
  });
});
