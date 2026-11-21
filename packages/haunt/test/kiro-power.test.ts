// H6.8 The Kiro Power package parses and points at real files.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const power = join(root, 'kiro-power');
const json = (f: string) => JSON.parse(readFileSync(join(power, f), 'utf8'));

describe('kiro power', () => {
  it('has a manifest with the required fields', () => {
    const m = json('plugin.json');
    expect(m.name).toBe('haunt');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.description).toBeTruthy();
    expect(m.author.name).toBeTruthy();
    expect(m.keywords.length).toBeGreaterThan(0);
  });
  it('mcp.json points at the real MCP entry and files', () => {
    const s = json('mcp.json').mcpServers.haunt;
    expect(s.command).toBe('node');
    for (const a of s.args) expect(existsSync(join(root, a))).toBe(true);
  });
  it('ships the skill with frontmatter', () => {
    const md = readFileSync(join(power, 'skills', 'stress-test-my-workflow', 'SKILL.md'), 'utf8');
    expect(md).toMatch(/^---\r?\nname: stress-test-my-workflow\r?\ndescription: .+\r?\n---/);
  });
});
