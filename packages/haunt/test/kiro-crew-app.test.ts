import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '..', '..', '..', 'kiro-crew-app');
const manifest = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));

describe('kiro-crew-app manifest', () => {
  it('has required fields and starts disabled', () => {
    expect(manifest.name).toBe('haunt');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.defaultEnabled).toBe(false);
  });
  it('every referenced file exists', () => {
    for (const a of manifest.agents) expect(existsSync(join(dir, a))).toBe(true);
    for (const s of manifest.skills) expect(existsSync(join(dir, s, 'SKILL.md'))).toBe(true);
    for (const p of manifest.ui.pages) expect(existsSync(join(dir, p.entry))).toBe(true);
  });
  it('declares the haunt MCP server with the real entry file', () => {
    const m = manifest.mcpServers.haunt;
    expect(m.command).toBe('node');
    expect(existsSync(join(dir, '..', m.args[1]))).toBe(true);
    expect(m.autoApprove).not.toContain('haunt_sweep');
  });
});
