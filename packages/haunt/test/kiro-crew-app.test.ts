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
  // covers: crew-app-bonus/R1.1 crew-app-bonus/R3.1
  it('declares the haunt MCP server as the bundled file inside the app folder', () => {
    const m = manifest.mcpServers.haunt;
    expect(m.command).toBe('node');
    expect(m.args).toEqual(['server/haunt-mcp.mjs']);
    expect(existsSync(join(dir, m.args[0]))).toBe(true);
    expect(m.autoApprove).not.toContain('haunt_sweep');
    expect(m.autoApprove).not.toContain('haunt_ramp');
    expect(manifest.permissions.network).toBe(false);
  });
  // covers: crew-app-bonus/R3.3
  it('the page is the built Chain Wizard with every asset it loads', () => {
    const html = readFileSync(join(dir, 'page', 'index.html'), 'utf8');
    expect(html).toContain('Chain Wizard');
    for (const m of html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)) expect(existsSync(join(dir, 'page', 'assets', m[1]!)), m[1]).toBe(true);
  });
  // covers: crew-app-bonus/R4.1
  it('has a license and no personal info', () => {
    expect(existsSync(join(dir, 'LICENSE'))).toBe(true);
    for (const f of ['app.json', 'README.md', 'WRITEUP.md', 'agents/reviewer.json']) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/gmail|spiker|deckedout|dcli|@outlook/i);
  });
});
